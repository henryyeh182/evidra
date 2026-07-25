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
      readinessScore: 76,
      fatigueScore: 24,
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

  assert.deepEqual(state.signalCoverage.usable, ["restingHeartRate"]);
  assert.ok(state.signalCoverage.missing.includes("hrv"));
  assert.ok(state.signalCoverage.missing.includes("sleep"));
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

  assert.deepEqual(state.signalCoverage.usable, ["restingHeartRate"]);
  assert.equal(state.recoveryScore, 100);
});

test("no fresh recovery signal falls back to a neutral score with empty coverage", () => {
  const context = minimalContext([
    { type: "hrv_ms", value: 40, unit: "ms", recordedAt: "2019-01-01T07:00:00+08:00", source: "apple_health" }
  ]);

  const state = generateSemanticFitnessState(context, { date: "2026-07-25", timezone: "Asia/Taipei" });

  assert.deepEqual(state.signalCoverage.usable, []);
  assert.equal(state.recoveryScore, 50);
  assert.equal(state.confidence, "low");
});
