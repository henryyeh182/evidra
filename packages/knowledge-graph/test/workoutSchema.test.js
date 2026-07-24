import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildExerciseGraph } from "../src/graph.js";
import { assertValidWorkout, isEntirelyInZone, totalWorkingSets, searchWorkouts } from "../src/workoutSchema.js";

const graphData = JSON.parse(
  await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
);
const workouts = JSON.parse(
  await readFile(new URL("../../../data/seeds/workouts.json", import.meta.url), "utf8")
);
const graph = buildExerciseGraph(graphData);

test("assertValidWorkout accepts grounded seed workouts", () => {
  for (const workout of workouts) {
    assert.equal(assertValidWorkout(workout, graph), true);
  }
});

test("assertValidWorkout rejects workouts that reference unknown exercises", () => {
  const bad = {
    id: "workout_bad",
    name: "Bad",
    durationMinutes: 10,
    blocks: [{ kind: "main", sets: [{ exerciseId: "exercise_ghost", reps: 5, intensity: { type: "rpe", value: 6 } }] }]
  };
  assert.throws(() => assertValidWorkout(bad, graph), /unknown exercise/);
});

test("isEntirelyInZone answers the all-Zone-2 query", () => {
  const zone2 = workouts.find((workout) => workout.id === "workout_zone2_base_run");
  const strength = workouts.find((workout) => workout.id === "workout_full_body_strength");
  assert.equal(isEntirelyInZone(zone2, 2), true);
  assert.equal(isEntirelyInZone(strength, 2), false);
});

test("totalWorkingSets counts main and accessory sets", () => {
  const strength = workouts.find((workout) => workout.id === "workout_full_body_strength");
  assert.equal(totalWorkingSets(strength), 3);
});

test("searchWorkouts finds all-Zone-2 and no-equipment short sessions", () => {
  const zone2 = searchWorkouts(workouts, graph, { inZone: 2 });
  assert.deepEqual(zone2.map((workout) => workout.id), ["workout_zone2_base_run"]);

  const shortNoKit = searchWorkouts(workouts, graph, { availableEquipment: [], maxDurationMinutes: 20 });
  assert.deepEqual(shortNoKit.map((workout) => workout.id), ["workout_no_equipment_20"]);
});
