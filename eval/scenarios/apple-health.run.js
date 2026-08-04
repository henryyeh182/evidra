/**
 * Run the Apple Health source-schema scenarios end to end.
 *
 * The path under test is the whole boundary, not a unit of it:
 *
 *   export.xml text → parseAppleHealthExportString
 *                   → validated against /schemas/sources/apple-health.export.json
 *                   → normalizeAppleHealthExport
 *                   → the scenario's schema checks
 *
 * What is measured is comprehension of the source schema — canonical naming,
 * unit conversion, source labelling, sentinels not leaking, and absent signals
 * staying absent — never whether a simulated athlete's numbers are plausible.
 *
 * The raw-shape validation is the part that earns its keep: it is what stops
 * the contract and the parser drifting apart, which is the whole reason
 * schemas/sources exists.
 */

import { readFile } from "node:fs/promises";

import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";
import {
  parseAppleHealthExportString,
  normalizeAppleHealthExport,
  applyNormalizedEventsToContext
} from "../../packages/connectors/src/index.js";
import { CANONICAL_SIGNALS, VENDOR_SCHEMAS } from "../../packages/evidence/src/index.js";
import { validate } from "../lib/jsonSchema.js";
import { APPLE_HEALTH_SCENARIOS } from "./apple-health.js";

export const DEFAULT_AS_OF = "2026-07-26";

const rawSchema = JSON.parse(
  await readFile(new URL("../../schemas/sources/apple-health.export.json", import.meta.url), "utf8")
);
const evidenceSchema = JSON.parse(
  await readFile(new URL("../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);

/** Ordinary context. None of it is under test; it is what a caller would send. */
const PROFILE = { timezone: "Asia/Taipei", fitnessLevel: "intermediate" };
const GOALS = [{ id: "general_fitness", type: "general_fitness", priority: 1 }];
const CONSTRAINTS = { injuries: [], equipment: ["bodyweight", "dumbbell"], availableMinutes: 60 };
const SCHEDULED_SESSION = {
  focus: "Zone 2 Run",
  type: "run",
  durationMinutes: 45,
  intensity: "moderate",
  targetMuscleGroups: ["legs"],
  exercises: ["Zone 2 Run"]
};

let rpcId = 0;
async function callTool(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: (rpcId += 1), method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  const text = response.result?.content?.map((part) => part.text).join("") ?? "";
  return JSON.parse(text);
}

/** What the registry promises an Apple Health user's evidence can contain. */
const DECLARED_APPLE_HEALTH_SIGNALS = [
  ...new Set(VENDOR_SCHEMAS.apple_health.signals.map((mapping) => mapping.to))
].sort();

/**
 * What two dialects of the same day must agree on.
 *
 * Identity of the whole event is too strong — ids are derived from the raw
 * activity type, which is allowed to differ. What must not differ is anything a
 * decision would read.
 */
function canonicalFingerprint(events) {
  return JSON.stringify(
    events
      .map((event) =>
        event.kind === "workout"
          ? {
              kind: "workout",
              type: event.type,
              startedAt: event.startedAt,
              durationMinutes: event.durationMinutes,
              trainingLoad: event.trainingLoad,
              rpe: event.rpe,
              loadSource: event.metadata.loadSource,
              distanceKm: event.metadata.totalDistanceKm
            }
          : {
              kind: "metric",
              type: event.type,
              value: event.value,
              unit: event.unit,
              recordedAt: event.recordedAt
            }
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
}

export async function runAppleHealthScenario(scenario, { asOf = DEFAULT_AS_OF } = {}) {
  const userId = `sim_ah_${scenario.id}`;
  const xml = scenario.build(asOf);
  const parsed = parseAppleHealthExportString(xml);

  const failures = [];

  // The raw export must match the contract that documents it. `validate`
  // returns { valid, errors } — reading it as an array is how a check quietly
  // stops being able to fail.
  const rawValidation = validate(parsed, rawSchema);
  if (!rawValidation.valid) {
    failures.push({
      name: "the parsed export matches schemas/sources/apple-health.export.json",
      detail: rawValidation.errors.slice(0, 3).join(" | ")
    });
  }

  if (parsed.records.length === 0 && parsed.workouts.length === 0) {
    failures.push({ name: "the export parsed into something", detail: "no records and no workouts" });
  }

  const events = normalizeAppleHealthExport(parsed);
  const context = applyNormalizedEventsToContext({ workouts: [], healthMetrics: [] }, events);
  const evidence = {
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    workouts: context.workouts,
    healthMetrics: context.healthMetrics
  };

  const evidenceValidation = validate(evidence, evidenceSchema);
  if (!evidenceValidation.valid) {
    failures.push({
      name: "the evidence built from this export is legal against the evidence contract",
      detail: evidenceValidation.errors.slice(0, 3).join(" | ")
    });
  }

  const state = await callTool("evidra_assess_fitness_state", { userId, date: asOf, evidence });
  const decision = await callTool("evidra_decide_session", {
    userId,
    date: asOf,
    evidence,
    scheduledSession: SCHEDULED_SESSION,
    availableMinutes: CONSTRAINTS.availableMinutes
  });

  for (const check of scenario.checks) {
    let outcome;
    try {
      outcome = check.run({
        events,
        parsed,
        state,
        decision,
        canonicalSignals: Object.keys(CANONICAL_SIGNALS),
        declaredSignals: DECLARED_APPLE_HEALTH_SIGNALS
      });
    } catch (error) {
      outcome = `threw: ${error.message}`;
    }
    if (outcome !== true) failures.push({ name: check.name, detail: outcome });
  }

  // Every shape must still reach a decision that explains itself. A scenario
  // that reads an export correctly and then produces an unusable decision has
  // not passed anything worth passing.
  if (!decision.decision?.type) {
    failures.push({ name: "a decision still lands", detail: "no decision type came back" });
  }
  if (!Array.isArray(decision.reason) || decision.reason.length === 0) {
    failures.push({ name: "the decision explains itself", detail: "no reason was given" });
  }
  if (!["low", "medium", "high"].includes(decision.confidence)) {
    failures.push({ name: "the decision carries confidence", detail: `confidence was ${decision.confidence}` });
  }
  for (const group of ["recovery", "training"]) {
    const coverage = state.signalCoverage?.[group];
    if (!coverage || !Array.isArray(coverage.usable) || !Array.isArray(coverage.missing)) {
      failures.push({ name: `signalCoverage.${group} reports what was read`, detail: "coverage group absent" });
    }
  }

  return {
    id: scenario.id,
    label: scenario.label,
    purpose: scenario.purpose,
    passed: failures.length === 0,
    checks: scenario.checks.length,
    failures,
    fingerprint: canonicalFingerprint(events),
    state,
    decision,
    counts: { records: parsed.records.length, workouts: parsed.workouts.length, events: events.length }
  };
}

export async function runAppleHealthScenarios({ asOf = DEFAULT_AS_OF } = {}) {
  const results = [];
  for (const scenario of APPLE_HEALTH_SCENARIOS) {
    results.push(await runAppleHealthScenario(scenario, { asOf }));
  }

  // Dialect equivalence is a claim about two scenarios at once, so it is checked
  // here rather than inside either one.
  for (const scenario of APPLE_HEALTH_SCENARIOS) {
    if (!scenario.equivalentTo) continue;
    const mine = results.find((result) => result.id === scenario.id);
    const theirs = results.find((result) => result.id === scenario.equivalentTo);
    if (!theirs) {
      mine.failures.push({ name: "dialect equivalence", detail: `no scenario ${scenario.equivalentTo} to compare` });
      mine.passed = false;
      continue;
    }
    if (mine.fingerprint !== theirs.fingerprint) {
      mine.failures.push({
        name: `normalizes identically to ${scenario.equivalentTo}`,
        detail: "the same day written in two dialects produced different evidence"
      });
      mine.passed = false;
    }
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runAppleHealthScenarios();
  let failed = 0;
  for (const result of results) {
    const mark = result.passed ? "✔" : "✖";
    console.log(`${mark} ${result.id}  (${result.checks} checks, ${result.counts.events} events)`);
    console.log(`   ${result.label}`);
    for (const failure of result.failures) {
      failed += 1;
      console.log(`   ✖ ${failure.name}`);
      console.log(`     ${failure.detail}`);
    }
  }
  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} scenarios passed.`);
  if (failed > 0) process.exitCode = 1;
}
