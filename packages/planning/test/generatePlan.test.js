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

/** The same user, but their last session was `gapDays` before the plan starts. */
function contextAfterBreak(gapDays, startDate = "2026-07-27") {
  const workouts = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 90 + gapDays; i > gapDays; i -= 2) {
    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() - i);
    workouts.push({
      id: `w_${i}`,
      startedAt: `${at.toISOString().slice(0, 10)}T07:00:00Z`,
      type: "run",
      durationMinutes: 45,
      trainingLoad: 70,
      rpe: 6
    });
  }
  return { ...context, workouts };
}

test("a plan that starts after a long break opens on a return ramp, not a base week", () => {
  // Without training history every plan opened at full base load, so someone
  // two months off got the identical first week to someone who trained
  // yesterday — including a high-intensity tempo run in week one.
  const plan = generateTrainingPlan(contextAfterBreak(60), { startDate: "2026-07-27", weeks: 4 });

  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["return", "return", "return", "deload"]
  );
  assert.ok(plan.weeks[0].loadMultiplier < 1, "the first week back must run under full load");
  assert.ok(
    plan.weeks[0].loadMultiplier < plan.weeks[1].loadMultiplier,
    "the ramp has to climb, not sit flat"
  );

  for (const session of plan.weeks[0].sessions) {
    assert.notEqual(session.intensity, "high", `${session.focus} should not be high intensity in week one back`);
  }

  assert.ok(
    plan.reasoning.some((line) => /Return to training/.test(line)),
    "the plan must say why it opened low"
  );
});

test("an athlete who is still training keeps the normal periodization", () => {
  const plan = generateTrainingPlan(contextAfterBreak(1), { startDate: "2026-07-27", weeks: 4 });

  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["base", "build", "peak", "deload"]
  );
  assert.equal(plan.weeks[0].loadMultiplier, 1, "a base week runs at full template load");
  assert.ok(
    !plan.reasoning.some((line) => /Return to training/.test(line)),
    "nobody who trained yesterday should be told to ease back"
  );
  assert.ok(
    !JSON.stringify(plan).includes("return-to-training week"),
    "no session should carry a return-to-training note"
  );
});
