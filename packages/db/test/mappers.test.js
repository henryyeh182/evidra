import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateSemanticFitnessState } from "../../semantic-engine/src/generateSemanticFitnessState.js";
import { mapSemanticStateToRow, mapUserContextToRows, stableId } from "../src/index.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("stableId creates deterministic database-safe identifiers", () => {
  assert.equal(
    stableId("user_henry_demo", "Preference", "Schedule", "weekday available minutes"),
    "user_henry_demo_preference_schedule_weekday_available_minutes"
  );
});

test("mapUserContextToRows maps the seed context into relational row groups", () => {
  const rows = mapUserContextToRows(context);

  assert.equal(rows.users.length, 1);
  assert.equal(rows.goals.length, 2);
  assert.equal(rows.preferences.length, 3);
  assert.equal(rows.injuries.length, 1);
  assert.equal(rows.equipment.length, 3);
  assert.equal(rows.workouts.length, 3);
  assert.equal(rows.health_metrics.length, 6);

  assert.deepEqual(rows.users[0], {
    id: "user_henry_demo",
    name: "Henry",
    timezone: "Asia/Taipei",
    height_cm: 175,
    weight_kg: 74,
    fitness_level: "intermediate"
  });

  assert.equal(rows.health_metrics[0].confidence, 1);
  assert.equal(rows.workouts[1].source, "strava");
});

test("mapSemanticStateToRow maps generated semantic state to database column names", () => {
  const state = generateSemanticFitnessState(context, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  const row = mapSemanticStateToRow(state);

  assert.equal(row.id, "user_henry_demo_semantic_state_2026_07_23");
  assert.equal(row.user_id, "user_henry_demo");
  assert.equal(row.state_date, "2026-07-23");
  assert.equal(row.recovery_score, 89);
  assert.equal(row.readiness_score, 76);
  assert.equal(row.recommended_focus, "Low-impact Zone 2 cardio + lower body mobility");
  assert.ok(Array.isArray(row.avoid));
  assert.ok(Array.isArray(row.reasoning));
  assert.equal(row.goal_alignment.primaryGoal, "half_marathon");
});
