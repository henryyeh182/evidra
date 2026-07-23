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
