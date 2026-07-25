import test from "node:test";
import assert from "node:assert/strict";

import { assertValidEvidence, evidenceToUserContext, describeEvidence } from "../src/index.js";

const evidence = {
  profile: { timezone: "Asia/Taipei", fitnessLevel: "advanced" },
  goals: [{ id: "g1", type: "half_marathon", priority: 1 }],
  constraints: {
    availableMinutes: 60,
    equipment: ["treadmill", "dumbbell"],
    injuries: [{ bodyRegion: "left_knee", restrictions: ["avoid high-impact jumping"], status: "active" }],
    avoidMovements: ["burpees"]
  },
  healthMetrics: [{ type: "hrv_ms", value: 38, recordedAt: "2026-07-27T06:00:00+08:00", source: "garmin" }],
  workouts: [
    {
      type: "run",
      startedAt: "2026-07-26T18:00:00+08:00",
      durationMinutes: 70,
      rpe: 8,
      trainingLoad: 112,
      muscleGroups: ["legs"],
      source: "garmin"
    }
  ]
};

test("evidence maps to a usable context without the server holding any data", () => {
  const context = evidenceToUserContext(evidence, { userId: "external_user" });

  assert.equal(context.user.id, "external_user");
  assert.equal(context.user.timezone, "Asia/Taipei");
  assert.equal(context.goals[0].type, "half_marathon");
  assert.equal(context.injuries[0].status, "active");
  assert.equal(context.equipment[0].type, "treadmill");
  assert.equal(context.healthMetrics[0].value, 38);
  assert.equal(context.workouts[0].trainingLoad, 112);
});

test("constraints become the preferences the engines read", () => {
  const context = evidenceToUserContext(evidence);
  const schedule = context.preferences.find((item) => item.key === "weekday_available_minutes");
  const avoid = context.preferences.find((item) => item.category === "avoid");

  assert.equal(schedule.value, 60);
  assert.deepEqual(avoid.value, ["burpees"]);
});

test("partial evidence still produces a context, gaps left visible", () => {
  const context = evidenceToUserContext({ healthMetrics: [], workouts: [] });

  assert.equal(context.workouts.length, 0);
  assert.equal(context.healthMetrics.length, 0);
  assert.ok(context.user.timezone, "a default timezone keeps date math well-defined");
});

test("unknown metric types are rejected rather than silently ignored", () => {
  assert.throws(
    () => assertValidEvidence({ healthMetrics: [{ type: "vo2max", value: 50, recordedAt: "2026-07-27" }] }),
    /Unknown evidence metric type/
  );
});

test("a metric without a value or timestamp is rejected", () => {
  assert.throws(
    () => assertValidEvidence({ healthMetrics: [{ type: "hrv_ms", value: "low", recordedAt: "2026-07-27" }] }),
    /numeric value/
  );
});

test("describeEvidence reports what actually arrived", () => {
  const summary = describeEvidence(evidence);

  assert.equal(summary.metricCount, 1);
  assert.equal(summary.workoutCount, 1);
  assert.deepEqual(summary.metricTypes, ["hrv_ms"]);
  assert.equal(summary.latest, "2026-07-27T06:00:00+08:00");
});
