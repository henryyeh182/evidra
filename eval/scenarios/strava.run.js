/**
 * Run the Strava bulk-export source-schema scenarios end to end.
 *
 * The path under test is the whole boundary, not a unit of it:
 *
 *   activities.csv text → parseStravaActivitiesCsv (header assertion included)
 *                       → validated against /schemas/sources/strava.export.json
 *                       → normalizeStravaExport
 *                       → assess_fitness_state / decide_session over JSON-RPC
 *                       → the scenario's schema checks
 *
 * What is measured is comprehension of the source schema — positional reading,
 * canonical naming, units, source labels, empty-is-not-zero, the offset the CSV
 * cannot supply, and coverage honesty — never whether a simulated athlete's
 * numbers are plausible.
 *
 * Two things are simulated rather than read. The FIT files are not present, so
 * a scenario declares the offset `readLocalTimezone` would have recovered and
 * this runner attaches it exactly as attachLocalOffsets does; and the archive
 * is passed as strings rather than a directory, so no test writes 45 CSVs to
 * disk. Everything between the CSV text and the decision is the real code.
 */

import { readFile } from "node:fs/promises";

import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";
import {
  parseStravaActivitiesCsv,
  parseStravaPreferencesCsv,
  parseStravaStructuredDetailsCsv,
  normalizeStravaExport,
  applyNormalizedEventsToContext
} from "../../packages/connectors/src/index.js";
import { VENDOR_SCHEMAS } from "../../packages/evidence/src/index.js";
import { validate } from "../lib/jsonSchema.js";
import { STRAVA_SCENARIOS } from "./strava.js";

export const DEFAULT_AS_OF = "2026-07-26";

const rawSchema = JSON.parse(
  await readFile(new URL("../../schemas/sources/strava.export.json", import.meta.url), "utf8")
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

/** What the registry promises a Strava export user's evidence can contain. */
export const DECLARED_STRAVA_EXPORT_SIGNALS = [
  ...new Set(VENDOR_SCHEMAS.strava_export.signals.map((mapping) => mapping.to))
].sort();

/**
 * The domain's workout types, read from the evidence contract rather than
 * restated here. The union exists as a JSDoc typedef with no runtime value, and
 * a second copy in a test file is exactly how a connector ends up quietly
 * inventing a seventh type.
 */
const WORKOUT_TYPES = evidenceSchema.properties.workouts.items.properties.type.enum;

/**
 * Attach the offset the FIT files would have given up.
 *
 * Mirrors attachLocalOffsets — the same four fields, set the same way — so a
 * scenario exercises the offset-present branch without this repo carrying
 * binary fixtures. A scenario declaring `offsetsSeconds: null` is the shape
 * where `readLocalTimezone` was never asked for.
 */
function attachDeclaredOffsets(activities, offsetsSeconds) {
  if (offsetsSeconds === null || offsetsSeconds === undefined) return activities;

  const sign = offsetsSeconds < 0 ? "-" : "+";
  const total = Math.abs(offsetsSeconds);
  const offset = `${sign}${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(
    Math.floor((total % 3600) / 60)
  ).padStart(2, "0")}`;

  for (const activity of activities) {
    if (!activity.startedAtUtc) continue;
    const local = new Date(new Date(activity.startedAtUtc).getTime() + offsetsSeconds * 1000)
      .toISOString()
      .slice(0, 19);
    activity.utcOffsetSeconds = offsetsSeconds;
    activity.utcOffset = offset;
    activity.startedAtLocalWallClock = local;
    activity.startedAtLocal = `${local}${offset}`;
    activity.timezoneKnown = true;
  }
  return activities;
}

export async function runStravaScenario(scenario, { asOf = DEFAULT_AS_OF } = {}) {
  const userId = `sim_sx_${scenario.id}`;
  const archive = scenario.build(asOf);
  const failures = [];

  // The header assertion is part of the contract, so a scenario is allowed to
  // expect a refusal. Anything else that throws is a failure, not an outcome.
  let activities = [];
  let parseError = null;
  try {
    activities = attachDeclaredOffsets(
      parseStravaActivitiesCsv(archive.activitiesCsv),
      archive.offsetsSeconds
    );
  } catch (error) {
    parseError = error;
  }

  const expected = scenario.expectParseError ?? archive.expectParseError ?? null;
  if (parseError && !expected) {
    failures.push({ name: "the export parsed at all", detail: parseError.message });
  }
  if (expected && !parseError) {
    failures.push({ name: "the export was refused", detail: "it parsed without complaint" });
  }
  if (expected && parseError && !expected.test(parseError.message)) {
    failures.push({
      name: "the refusal said why",
      detail: `expected ${expected}, got: ${parseError.message}`
    });
  }

  const parsed = {
    activities,
    anchors: archive.preferencesCsv
      ? parseStravaPreferencesCsv(archive.preferencesCsv, { asOf: new Date(`${asOf}T00:00:00Z`) })
      : null,
    structuredSets: archive.structuredCsv ? parseStravaStructuredDetailsCsv(archive.structuredCsv) : [],
    files: {
      "activities.csv": true,
      "general_preferences.csv": archive.preferencesCsv !== null && archive.preferencesCsv !== undefined,
      "structured_details.csv": archive.structuredCsv !== null && archive.structuredCsv !== undefined
    }
  };

  // The raw shape must match the contract that documents it. `validate` returns
  // { valid, errors } — reading it as an array is how a check quietly stops
  // being able to fail. A refused export has nothing to validate.
  if (!parseError) {
    const rawValidation = validate(parsed, rawSchema);
    if (!rawValidation.valid) {
      failures.push({
        name: "the parsed export matches schemas/sources/strava.export.json",
        detail: rawValidation.errors.slice(0, 3).join(" | ")
      });
    }
    if (parsed.activities.length === 0) {
      failures.push({ name: "the export parsed into something", detail: "no activities" });
    }
  }

  const events = parseError ? [] : normalizeStravaExport(parsed);
  const context = applyNormalizedEventsToContext({ workouts: [], healthMetrics: [] }, events);
  const evidence = {
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    workouts: context.workouts,
    healthMetrics: context.healthMetrics
  };

  if (!parseError) {
    const evidenceValidation = validate(evidence, evidenceSchema);
    if (!evidenceValidation.valid) {
      failures.push({
        name: "the evidence built from this export is legal against the evidence contract",
        detail: evidenceValidation.errors.slice(0, 3).join(" | ")
      });
    }
  }

  const state = await callTool("assess_fitness_state", { userId, date: asOf, evidence });
  const decision = await callTool("decide_session", {
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
        parseError,
        state,
        decision,
        evidence,
        asOf,
        workoutTypes: WORKOUT_TYPES,
        declaredSignals: DECLARED_STRAVA_EXPORT_SIGNALS
      });
    } catch (error) {
      outcome = `threw: ${error.message}`;
    }
    if (outcome !== true) failures.push({ name: check.name, detail: outcome });
  }

  // Every shape that produced evidence must still reach a decision that
  // explains itself. A refused export is exempt: there is nothing to decide on,
  // and that is the correct outcome rather than a degraded one.
  if (!parseError) {
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
  }

  return {
    id: scenario.id,
    label: scenario.label,
    purpose: scenario.purpose,
    passed: failures.length === 0,
    checks: scenario.checks.length,
    failures,
    state,
    decision,
    counts: { activities: parsed.activities.length, events: events.length }
  };
}

export async function runStravaScenarios({ asOf = DEFAULT_AS_OF } = {}) {
  const results = [];
  for (const scenario of STRAVA_SCENARIOS) {
    results.push(await runStravaScenario(scenario, { asOf }));
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runStravaScenarios();
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
