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

test("SQLite repository persists and scopes outcome events", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const event = {
      outcomeId: "out_test_1",
      caseId: "decision_test_1",
      outcome: { status: "completed", perceivedEffort: 7 },
      recordedAt: "2026-08-12T10:00:00.000Z"
    };
    await repository.saveOutcome(event, { userId: "athlete-1", decisionId: "dec_test_1" });
    assert.deepEqual(await repository.listOutcomes("decision_test_1", "athlete-1"), [{
      ...event,
      userId: "athlete-1",
      decisionId: "dec_test_1"
    }]);
    assert.deepEqual(await repository.listOutcomes("decision_test_1", "athlete-2"), []);
  } finally {
    repository.close();
  }
});

test("SQLite repository persists a decision trace", () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const record = {
      decisionId: "dec_test_persisted",
      createdAt: Date.now(),
      userId: "athlete-1",
      evidenceSource: "local-user-context",
      tool: "decide_session",
      trace: { decision: { type: "adjust" }, versions: { release: "0.5.0" } }
    };
    repository.saveDecisionRecord(record);
    assert.deepEqual(repository.getDecisionRecord(record.decisionId, "athlete-1"), record);
    assert.equal(repository.getDecisionRecord(record.decisionId, "athlete-2"), null);
  } finally {
    repository.close();
  }
});
