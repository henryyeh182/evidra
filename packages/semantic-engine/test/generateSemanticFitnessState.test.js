// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSemanticFitnessState } from "../src/generateSemanticFitnessState.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("generateSemanticFitnessState returns the core semantic fields", () => {
  const state = generateSemanticFitnessState(context, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  assert.equal(state.userId, "user_henry_demo");
  assert.equal(state.date, "2026-07-23");
  assert.equal(state.timezone, "Asia/Taipei");
  assert.equal(typeof state.recoveryScore, "number");
  assert.equal(typeof state.readinessScore, "number");
  assert.equal(typeof state.trainingLoad7d, "number");
  assert.equal(typeof state.trainingLoad28d, "number");
  assert.equal(typeof state.muscleFatigue.legs, "number");
  assert.ok(state.reasoning.length >= 4);
});

test("generateSemanticFitnessState respects active restrictions and fatigue", () => {
  const state = generateSemanticFitnessState(context, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  assert.ok(state.avoid.includes("avoid heavy lower body when fatigued"));
  assert.ok(state.avoid.includes("avoid burpees"));
  assert.match(state.recommendedFocus, /Low-impact|Recovery|Zone 2/);
});

test("generateSemanticFitnessState is deterministic for the golden sample user", () => {
  const state = generateSemanticFitnessState(context, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  assert.deepEqual(
    {
      recoveryScore: state.recoveryScore,
      readinessScore: state.readinessScore,
      fatigueScore: state.fatigueScore,
      trainingLoad7d: state.trainingLoad7d,
      trainingLoad28d: state.trainingLoad28d,
      acuteChronicWorkloadRatio: state.acuteChronicWorkloadRatio,
      recommendedFocus: state.recommendedFocus
    },
    {
      recoveryScore: 89,
      readinessScore: 71,
      fatigueScore: 29,
      trainingLoad7d: 198,
      trainingLoad28d: 198,
      acuteChronicWorkloadRatio: 0.55,
      recommendedFocus: "Low-impact Zone 2 cardio + lower body mobility"
    }
  );
});

function minimalContext(healthMetrics) {
  return {
    user: { id: "u", name: "U", timezone: "Asia/Taipei", heightCm: 175, weightKg: 74, fitnessLevel: "intermediate" },
    goals: [{ id: "g", type: "build_muscle", priority: 1, label: "strength" }],
    preferences: [{ category: "schedule", key: "weekday_available_minutes", value: 30 }],
    injuries: [],
    equipment: [{ type: "dumbbell", available: true }],
    workouts: [],
    healthMetrics
  };
}

test("stale recovery signals are excluded and confidence drops to low", () => {
  const context = minimalContext([
    // fresh resting HR only; HRV is years old (stale)
    { type: "resting_hr_bpm", value: 55, unit: "bpm", recordedAt: "2026-07-24T07:00:00+08:00", source: "apple_health" },
    { type: "hrv_ms", value: 40, unit: "ms", recordedAt: "2019-01-01T07:00:00+08:00", source: "apple_health" }
  ]);

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.recovery.usable, ["restingHeartRate"]);
  assert.ok(state.signalCoverage.recovery.missing.includes("hrv"));
  assert.ok(state.signalCoverage.recovery.missing.includes("sleep"));
  assert.equal(state.confidence, "low");
  assert.equal(state.sleepQuality, null);
  assert.ok(state.reasoning.some((line) => line.includes("No fresh reading")));
});

test("recovery renormalizes over present signals instead of using neutral filler", () => {
  // resting HR only, value at baseline -> score 100; recovery should equal it,
  // not be dragged toward 50 by absent hrv/sleep/stress.
  const context = minimalContext([
    { type: "resting_hr_bpm", value: 57, unit: "bpm", recordedAt: "2026-07-25T07:00:00+08:00", source: "apple_health" }
  ]);

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.recovery.usable, ["restingHeartRate"]);
  assert.equal(state.recoveryScore, 100);
});

test("no fresh recovery signal falls back to a neutral score with empty coverage", () => {
  const context = minimalContext([
    { type: "hrv_ms", value: 40, unit: "ms", recordedAt: "2019-01-01T07:00:00+08:00", source: "apple_health" }
  ]);

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.recovery.usable, []);
  assert.equal(state.recoveryScore, 50);
  assert.equal(state.confidence, "low");
});

test("an unstated time constraint is reported as unknown, not as 30 minutes", () => {
  // A guessed number is indistinguishable from a real one downstream, and the
  // decision layer quotes it back to the athlete as their own constraint.
  const context = minimalContext([
    { type: "resting_hr_bpm", value: 57, unit: "bpm", recordedAt: "2026-07-25T07:00:00+08:00", source: "apple_health" }
  ]);
  context.preferences = context.preferences.filter((item) => item.category !== "schedule");

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.equal(state.availableTimeMinutes, null);
});

test("a stated time constraint is passed through untouched", () => {
  const context = minimalContext([
    { type: "resting_hr_bpm", value: 57, unit: "bpm", recordedAt: "2026-07-25T07:00:00+08:00", source: "apple_health" }
  ]);

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.equal(state.availableTimeMinutes, 30);
});

// --- training-side coverage ----------------------------------------------
//
// A session skipped for want of a load used to vanish without trace: the muscle
// groups it would have loaded simply read as rested, while coverage still said
// nothing was missing and confidence still said "high".

function contextWithLastWorkoutUnloaded() {
  const copy = JSON.parse(JSON.stringify(context));
  const last = copy.workouts.at(-1);
  last.trainingLoad = null;
  return { copy, date: last.startedAt.slice(0, 10) };
}

test("a full week of loaded sessions reports training coverage as complete", () => {
  const date = context.workouts.at(-1).startedAt.slice(0, 10);
  const state = generateSemanticFitnessState(context, { date, timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.training.usable, ["trainingLoad"]);
  assert.deepEqual(state.signalCoverage.training.missing, []);
});

test("a session with no load is reported missing, not quietly dropped", () => {
  const { copy, date } = contextWithLastWorkoutUnloaded();
  const state = generateSemanticFitnessState(copy, { date, timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.training.missing, ["trainingLoad"]);
  // Strict on purpose: one unloaded session is enough to make the week partial.
  assert.deepEqual(state.signalCoverage.training.usable, []);
});

test("a session with no RPE still produces muscle fatigue from the vendor load", () => {
  // Garmin never reports an RPE. Its activityTrainingLoad is the vendor's own
  // effort figure and is taken as it stands, so fatigue is fully computable.
  const copy = JSON.parse(JSON.stringify(context));
  for (const workout of copy.workouts) workout.rpe = null;
  const date = copy.workouts.at(-1).startedAt.slice(0, 10);

  const rated = generateSemanticFitnessState(context, { date, timezone: "Asia/Taipei" });
  const unrated = generateSemanticFitnessState(copy, { date, timezone: "Asia/Taipei" });

  assert.deepEqual(unrated.muscleFatigue, rated.muscleFatigue, "RPE is not a term in the sum");
  assert.deepEqual(unrated.signalCoverage.training.missing, [], "a missing RPE is not a coverage gap");
  assert.equal(unrated.confidence, rated.confidence, "and it must not cost the source its confidence");
});

test("an incomplete training week cannot report high confidence", () => {
  const { copy, date } = contextWithLastWorkoutUnloaded();
  const loaded = generateSemanticFitnessState(context, { date, timezone: "Asia/Taipei" });
  const unloaded = generateSemanticFitnessState(copy, { date, timezone: "Asia/Taipei" });

  assert.equal(loaded.confidence, "high", "recovery signals alone would support high");
  assert.notEqual(unloaded.confidence, "high");
});

test("the reasoning names how many sessions were left out of muscle fatigue", () => {
  const { copy, date } = contextWithLastWorkoutUnloaded();
  const loaded = generateSemanticFitnessState(context, { date, timezone: "Asia/Taipei" });
  const unloaded = generateSemanticFitnessState(copy, { date, timezone: "Asia/Taipei" });

  const line = unloaded.reasoning.find((r) => r.includes("sessions in the last 7 days"));
  assert.ok(line, "the skip has to be stated, not inferred from a shorter list");
  assert.match(line, /^1 of \d+ sessions .* carry no training load/);

  // ...and the muscle groups that session would have loaded really did vanish.
  const lost = Object.keys(loaded.muscleFatigue).filter((g) => !(g in unloaded.muscleFatigue));
  assert.ok(lost.length > 0, "the fixture must actually lose a muscle group for this to prove anything");
});

test("recovery and training gaps stay in separate groups", () => {
  const { copy, date } = contextWithLastWorkoutUnloaded();
  const state = generateSemanticFitnessState(copy, { date, timezone: "Asia/Taipei" });

  // The recovery half is untouched by a training-side gap, and vice versa.
  assert.deepEqual(state.signalCoverage.recovery.missing, []);
  assert.ok(state.signalCoverage.training.missing.length > 0);
});
