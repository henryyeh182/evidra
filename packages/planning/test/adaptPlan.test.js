import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan } from "../src/generatePlan.js";
import { previewPlanChange } from "../src/adaptPlan.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

function basePlan() {
  return generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
}

test("previewPlanChange does not mutate the original plan", () => {
  const plan = basePlan();
  const before = structuredClone(plan);
  previewPlanChange(plan, { kind: "reduce_availability", weekdayAvailableMinutes: 25 });
  assert.deepEqual(plan, before);
});

test("reduce_availability trims sessions and records a diff", () => {
  const plan = basePlan();
  const preview = previewPlanChange(plan, {
    kind: "reduce_availability",
    weekdayAvailableMinutes: 25,
    weekIndexes: [1],
    reason: "Travel week"
  });

  assert.equal(preview.baseVersion, 1);
  assert.ok(preview.diff.length > 0);
  assert.equal(preview.resultingPlan.constraints.weekdayAvailableMinutes, 25);

  const week1 = preview.resultingPlan.weeks[1];
  for (const session of week1.sessions) {
    const cap = /long/i.test(session.focus) ? 40 : 25;
    assert.ok(session.durationMinutes <= cap);
  }
  // Untouched weeks keep their original durations.
  assert.ok(preview.resultingPlan.weeks[0].sessions.some((s) => s.durationMinutes > 25));
});

test("add_injury downgrades intensity and removes contraindicated work", () => {
  const plan = basePlan();
  const preview = previewPlanChange(plan, {
    kind: "add_injury",
    bodyRegion: "left_shoulder",
    avoidMovements: ["bench press", "overhead"],
    reason: "Shoulder impingement"
  });

  assert.ok(preview.diff.length > 0);
  const allExercises = preview.resultingPlan.weeks.flatMap((week) =>
    week.sessions.flatMap((session) => session.exercises)
  );
  assert.ok(!allExercises.some((name) => /bench press/i.test(name)));
});

test("deload_week cuts volume for the targeted week only", () => {
  const plan = basePlan();
  const preview = previewPlanChange(plan, { kind: "deload_week", weekIndex: 1 });

  const originalWeek1 = plan.weeks[1];
  const deloadWeek1 = preview.resultingPlan.weeks[1];
  assert.equal(deloadWeek1.phase, "deload");
  for (let i = 0; i < deloadWeek1.sessions.length; i += 1) {
    assert.ok(deloadWeek1.sessions[i].durationMinutes <= originalWeek1.sessions[i].durationMinutes);
  }
  // Week 0 is unaffected.
  assert.deepEqual(preview.resultingPlan.weeks[0], plan.weeks[0]);
});

test("previewPlanChange rejects unknown change kinds", () => {
  const plan = basePlan();
  assert.throws(() => previewPlanChange(plan, { kind: "teleport" }), /Unknown change request kind/);
});
