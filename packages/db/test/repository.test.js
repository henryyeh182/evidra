// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { generateTrainingPlan } from "../../planning/src/index.js";
import { SQLiteFitnessRepository } from "../src/index.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("SQLite repository round-trips user context and plan/planned workouts", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    await repository.saveUserContext(context);
    const loadedContext = await repository.getUserContext(context.user.id);
    assert.equal(loadedContext.user.id, context.user.id);
    assert.equal(loadedContext.workouts.length, context.workouts.length);
    assert.equal(loadedContext.healthMetrics.length, context.healthMetrics.length);

    const plan = generateTrainingPlan(context, { startDate: "2026-07-23", weeks: 2 });
    await repository.savePlan(plan);
    const loadedPlan = await repository.getPlan(plan.id, context.user.id);
    assert.equal(loadedPlan.id, plan.id);
    assert.equal(loadedPlan.version, 1);
    assert.equal(loadedPlan.weeks.length, 2);
    assert.equal(
      loadedPlan.weeks.flatMap((week) => week.sessions).length,
      plan.weeks.flatMap((week) => week.sessions).length
    );

    const scheduled = await repository.getPlannedWorkoutForDate(context.user.id, "2026-07-23");
    assert.equal(scheduled.planId, plan.id);
    assert.equal(scheduled.date, "2026-07-23");
    assert.ok(scheduled.id);
  } finally {
    repository.close();
  }
});
