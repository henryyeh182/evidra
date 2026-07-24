import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan } from "../src/generatePlan.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("generateTrainingPlan builds a periodized multi-week plan", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });

  assert.equal(plan.userId, "user_henry_demo");
  assert.equal(plan.goalId, "goal_half_marathon");
  assert.equal(plan.periodizationType, "linear_endurance");
  assert.equal(plan.weeks.length, 4);
  assert.equal(plan.endDate, "2026-08-23");
  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["base", "build", "peak", "deload"]
  );
});

test("generateTrainingPlan caps sessions to weekday availability", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const week0 = plan.weeks[0];

  const weekdaySessions = week0.sessions.filter((session) => !/long/i.test(session.focus));
  for (const session of weekdaySessions) {
    assert.ok(session.durationMinutes <= 45, `${session.focus} should respect the 45 min cap`);
  }

  const longRun = week0.sessions.find((session) => /long/i.test(session.focus));
  assert.equal(longRun.durationMinutes, 72);
});

test("generateTrainingPlan applies injury safety constraints", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const tempo = plan.weeks[0].sessions.find((session) => session.date === "2026-07-30");

  // Active knee / high-impact restriction downgrades the tempo run.
  assert.equal(tempo.intensity, "moderate");
  assert.match(tempo.focus, /Controlled Zone 2 run/);
  assert.match(tempo.rationale, /Downgraded high-intensity run/);
});

test("generateTrainingPlan deload week reduces volume", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const base = plan.weeks[0].sessions.find((session) => session.type === "strength");
  const deload = plan.weeks[3].sessions.find((session) => session.type === "strength");

  assert.equal(plan.weeks[3].phase, "deload");
  assert.ok(deload.durationMinutes < base.durationMinutes);
});

test("generateTrainingPlan is deterministic for the golden sample user", () => {
  const a = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const b = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  assert.deepEqual(a, b);
});
