import test from "node:test";
import assert from "node:assert/strict";

import { evidenceToUserContext, describeSourceCoverage, sourcesProviding } from "../src/index.js";
import { generateSemanticFitnessState } from "../../semantic-engine/src/index.js";
import { decideSession } from "../../decision-engine/src/index.js";

const DATE = "2026-07-27";
const at = (daysAgo = 0) => {
  const d = new Date(`${DATE}T06:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
};

const base = {
  profile: { timezone: "UTC" },
  goals: [{ type: "half_marathon", priority: 1 }],
  constraints: { availableMinutes: 60 },
  workouts: [
    { type: "run", startedAt: at(1), durationMinutes: 60, rpe: 7, trainingLoad: 70, muscleGroups: ["legs"] },
    { type: "run", startedAt: at(3), durationMinutes: 45, rpe: 6, trainingLoad: 50, muscleGroups: ["legs"] }
  ]
};

const session = {
  focus: "Tempo Run",
  type: "run",
  durationMinutes: 45,
  intensity: "high",
  targetMuscleGroups: ["legs"],
  exercises: ["Tempo Run"]
};

/** Every realistic device mix a user might arrive with. */
const SOURCE_MIXES = {
  "oura (full sleep)": {
    healthMetrics: [
      { type: "sleep_duration_hours", value: 7.5, recordedAt: at(0), source: "oura" },
      { type: "sleep_quality", value: 82, recordedAt: at(0), source: "oura" },
      { type: "hrv_ms", value: 55, recordedAt: at(0), source: "oura" },
      { type: "resting_hr_bpm", value: 52, recordedAt: at(0), source: "oura" }
    ]
  },
  "garmin (no sleep, has composites)": {
    healthMetrics: [{ type: "resting_hr_bpm", value: 58, recordedAt: at(0), source: "garmin" }],
    vendorAssessments: [
      { source: "garmin", type: "body_battery", value: 45, recordedAt: at(0) },
      { source: "garmin", type: "recovery_time_minutes", value: 1200, recordedAt: at(0) }
    ]
  },
  "whoop (no sleep record, vendor readiness)": {
    healthMetrics: [{ type: "hrv_ms", value: 48, recordedAt: at(0), source: "whoop" }],
    vendorAssessments: [{ source: "whoop", type: "vendor_readiness", value: 38, recordedAt: at(0) }]
  },
  "apple health only (hrv + rhr, no sleep)": {
    healthMetrics: [
      { type: "hrv_ms", value: 41, recordedAt: at(1), source: "apple_health" },
      { type: "resting_hr_bpm", value: 61, recordedAt: at(1), source: "apple_health" }
    ]
  },
  "strava only (activities, zero physiology)": {
    healthMetrics: []
  },
  "nothing but a plan": {
    healthMetrics: [],
    workouts: []
  }
};

for (const [label, extra] of Object.entries(SOURCE_MIXES)) {
  test(`decision still lands with source mix: ${label}`, () => {
    const evidence = { ...base, ...extra };
    const context = evidenceToUserContext(evidence, { userId: "u" });
    const state = generateSemanticFitnessState(context, { date: DATE, timezone: "UTC" });

    // Missing sleep must never break the pipeline for anyone.
    assert.equal(typeof state.recoveryScore, "number", "recovery must resolve");
    assert.equal(typeof state.readinessScore, "number", "readiness must resolve");
    assert.ok(Number.isFinite(state.recoveryScore) && !Number.isNaN(state.recoveryScore));

    const decision = decideSession({ scheduledSession: session, state });
    assert.ok(decision.decision.type, "a decision is always produced");
    assert.ok(decision.reason.length > 0, "and it always explains itself");
    assert.ok(["low", "medium", "high"].includes(decision.confidence));
  });
}

test("a user with no sleep is not silently treated as well-rested", () => {
  const withSleep = evidenceToUserContext({ ...base, ...SOURCE_MIXES["oura (full sleep)"] });
  const withoutSleep = evidenceToUserContext({ ...base, ...SOURCE_MIXES["apple health only (hrv + rhr, no sleep)"] });

  const a = generateSemanticFitnessState(withSleep, { date: DATE, timezone: "UTC" });
  const b = generateSemanticFitnessState(withoutSleep, { date: DATE, timezone: "UTC" });

  assert.ok(a.signalCoverage.recovery.usable.includes("sleep"));
  assert.ok(b.signalCoverage.recovery.missing.includes("sleep"), "the gap is reported, not papered over");
  // The score is renormalized over what is present rather than filled with 50.
  assert.notEqual(b.recoveryScore, 50);
});

test("a vendor composite carries the score when raw physiology is absent", () => {
  const context = evidenceToUserContext({ ...base, ...SOURCE_MIXES["garmin (no sleep, has composites)"] });
  const state = generateSemanticFitnessState(context, { date: DATE, timezone: "UTC" });

  assert.ok(state.signalCoverage.recovery.usable.includes("bodyBattery"));
  assert.equal(state.confidence, "high", "the device maker already integrated what we cannot see");
});

test("source coverage is knowable before any decision is attempted", () => {
  const strava = describeSourceCoverage(["strava"]);
  assert.equal(strava.hasRecoveryEvidence, false, "Strava carries no recovery physiology");
  assert.ok(strava.missingRecoverySignals.includes("sleep_duration_hours"));

  const mixed = describeSourceCoverage(["garmin", "oura"]);
  assert.ok(mixed.hasRecoveryEvidence);
  assert.ok(mixed.availableSignals.includes("sleep_duration_hours"));

  assert.deepEqual(describeSourceCoverage(["fitbit"]).unknownSources, ["fitbit"]);
});

test("an activity-only source is described by the load it carries, not the physiology it lacks", () => {
  const strava = describeSourceCoverage(["strava"]);
  assert.ok(
    strava.availableSignals.includes("session_relative_effort"),
    "Strava's contribution is per-session load, and the registry says so"
  );
  assert.equal(strava.hasRecoveryEvidence, false, "which is still not recovery physiology");

  // The bulk export is a second dialect of the same platform: no OAuth, more
  // columns, and load that only exists when the session recorded power.
  const exported = describeSourceCoverage(["strava_export"]);
  assert.deepEqual(exported.availableSignals, [
    "session_intensity_factor",
    "session_relative_effort",
    "session_training_load"
  ]);
  assert.equal(exported.hasRecoveryEvidence, false);
});

test("the registry answers which platforms supply a given signal", () => {
  const sleepSources = sourcesProviding("sleep_duration_hours");
  for (const expected of ["apple_health", "garmin", "google_health_connect", "oura", "whoop"]) {
    assert.ok(sleepSources.includes(expected), `${expected} should be a sleep source`);
  }
  assert.ok(!sleepSources.includes("strava"));
});
