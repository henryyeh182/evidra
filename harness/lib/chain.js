// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The decision chain, run without the MCP server.
 *
 * `evidra_decide_session` does three things before the engine sees anything:
 * it turns a user context into a semantic fitness state, it supersedes the
 * crude 7d/28d ratio with the impulse-response one when the history is long
 * enough, and it normalizes however the caller spelled a movement into
 * canonical ids. All three change what the engine decides, so a harness that
 * called `decideSession` on a hand-written state would be checking a different
 * pipeline from the one that ships.
 *
 * What is deliberately not here is the tool boundary itself — argument
 * validation, evidence resolution, JSON-RPC. Those are `eval/`'s subject. This
 * file starts where the caller's evidence has already arrived and stops where
 * the decision is made.
 *
 * Kept in step with `decideSessionTool` in apps/mcp-server/src/toolHandlers.js
 * by hand. `harness/test/harness.test.js` asserts the two produce the same
 * decision for the same scenario, so a change to one that is not made here is
 * a failing test rather than a silent divergence.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { generateSemanticFitnessState } from "../../packages/semantic-engine/src/index.js";
import { decideSession } from "../../packages/decision-engine/src/index.js";
import { computeTrainingLoad } from "../../packages/training-load/src/index.js";
import { buildExerciseGraph } from "../../packages/knowledge-graph/src/index.js";
import { evidenceToUserContext } from "../../packages/evidence/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");

let graphPromise = null;

/**
 * The catalog, loaded once per process.
 *
 * Not optional, and not a detail. EVD-R-009 matches restrictions against a
 * movement's spoken name; with no catalog injected the engine falls back to
 * `identityDisplay`, where the spoken name is the raw id — and that is the
 * exact failure mode the rule's own limitations record ("avoid heavy lower
 * body" striking exercise_lower_body_mobility). A harness that skipped the
 * catalog would be testing the fallback rather than the product.
 */
async function loadGraph() {
  if (!graphPromise) {
    graphPromise = readFile(join(rootDir, "data/seeds/exercises-graph.json"), "utf8")
      .then((text) => buildExerciseGraph(JSON.parse(text)));
  }
  return graphPromise;
}

/**
 * Freeze a structure to the leaves.
 *
 * Determinism has two halves and only one of them is "same answer twice". The
 * other is that the engine did not reach into the caller's evidence and change
 * it — a caller holding the plan (which is the whole Phase 1 arrangement) has
 * to be able to hand the same object to two tools. ES modules run in strict
 * mode, so an assignment to a frozen property throws rather than failing
 * quietly, which turns a mutation into a test failure at the line that made it.
 */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Run one scenario end to end: evidence -> state -> decision.
 *
 * `freeze` is the mutation probe, and it is separate from the ordinary run for
 * a reason: a chain that writes to its input throws under it, which would take
 * the other six checks down with it. So the harness runs the scenario twice —
 * once frozen to find out, once not, so the rest of the checks still have a
 * decision to examine — and reports the mutation as the finding it is.
 *
 * `overrideState` is the boundary probe and it is the one place this file hands
 * the engine a state it did not compute from the evidence. It exists because a
 * scenario that sits just short of a threshold and does not fire proves less
 * than it looks: on a rule with more than one threshold, the silence may be
 * some *other* condition failing, and from outside the two are identical. The
 * probe re-runs the same scenario with that one quantity pushed across the
 * line; if the rule then fires, the silence is attributable. It is the same
 * move DH-6 makes by removing a signal, done in the other direction.
 *
 * Nothing but `DH-BND` may use it. A scenario cannot reach it — it is not a
 * field on the scenario file — so an evidence-driven harness cannot be turned
 * into a state-driven one by writing a scenario.
 *
 * @param {object} scenario a parsed harness scenario
 * @param {{ freeze?: boolean, overrideState?: (state: object) => object }} [options]
 * @returns {Promise<{ scenario: object, state: object, decision: object }>}
 */
export async function runChain(scenario, { freeze = false, overrideState = null } = {}) {
  const graph = await loadGraph();
  const displayNameFor = (id) => graph.displayNameFor(id);
  const toCanonicalIds = (values = []) =>
    values.map((value) => graph.resolveExercise(value)?.id ?? value);

  // Scenarios hold Evidence, not a user context, because Evidence is what a
  // caller actually sends. Writing them as contexts made the harness look right
  // and check the wrong thing: `constraints.injuries` is where restrictions
  // live on the way in, and a context-shaped scenario carried its injuries in a
  // field the tool never reads — every restriction silently absent, and the
  // injury checks passing on scenarios that had no injuries in them.
  const evidence = freeze
    ? deepFreeze(structuredClone(scenario.evidence))
    : structuredClone(scenario.evidence);
  const context = evidenceToUserContext(evidence, { userId: evidence.profile?.userId });
  const date = scenario.date;

  const state = generateSemanticFitnessState(context, {
    date,
    timezone: context.user.timezone
  });

  const trainingLoad = computeTrainingLoad(context.workouts, { asOf: date });

  const canonicalize = (session) =>
    session
      ? { ...session, exerciseIds: toCanonicalIds(session.exerciseIds || session.exercises || []) }
      : null;

  // What the engine is actually handed, kept rather than rebuilt: the ratio the
  // decision reads is the impulse-response one whenever the history has
  // converged, and a check that went back to the semantic state for it would be
  // comparing the decision against a number the decision never saw.
  const computedState = trainingLoad.coverage.sufficient
    ? { ...state, acuteChronicWorkloadRatio: trainingLoad.acwr, trainingLoad }
    : { ...state, trainingLoad };

  const engineState = overrideState ? overrideState(structuredClone(computedState)) : computedState;

  const decision = decideSession({
    scheduledSession: canonicalize(scenario.scheduledSession),
    proposedSession: canonicalize(scenario.proposedSession),
    displayNameFor,
    state: engineState,
    availableMinutes: scenario.availableMinutes ?? undefined,
    intensityDistributions: context.workouts
      .filter((workout) => workout.intensityDistribution)
      .map((workout) => ({
        startedAt: workout.startedAt,
        boundarySource: workout.intensityDistribution.boundarySource,
        derivation: workout.intensityDistribution.derivation
      }))
  });

  return { scenario, state, engineState, decision };
}

/**
 * The same scenario with one recovery signal taken away.
 *
 * This is how the harness asks whether a gap is reported or filled. Comparing
 * two runs is the only way to ask it: a single decision that names a plausible
 * readiness gives no way to tell whether the signal behind it was measured or
 * assumed, and every fabricated value in this system would look exactly like a
 * measured one from inside a single output.
 *
 * @param {object} scenario
 * @param {string[]} metricTypes health metric types to drop from the evidence
 */
export function withoutMetrics(scenario, metricTypes) {
  const dropped = new Set(metricTypes);
  return {
    ...scenario,
    id: `${scenario.id}::without(${metricTypes.join(",")})`,
    evidence: {
      ...scenario.evidence,
      healthMetrics: (scenario.evidence.healthMetrics || []).filter(
        (metric) => !dropped.has(metric.type)
      )
    }
  };
}

/** Load every scenario in `harness/scenarios`, in filename order. */
export async function loadScenarios(directory = join(__dirname, "../scenarios")) {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const scenarios = [];
  for (const file of files) {
    const scenario = JSON.parse(await readFile(join(directory, file), "utf8"));
    scenarios.push({ ...scenario, file });
  }
  return scenarios;
}
