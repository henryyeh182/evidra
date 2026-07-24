import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildExerciseGraph } from "../src/graph.js";

const data = JSON.parse(
  await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
);
const graph = buildExerciseGraph(data);

test("buildExerciseGraph loads nodes and edges", () => {
  assert.ok(graph.size >= 20);
  assert.equal(graph.getExercise("exercise_back_squat").name, "Back Squat");
  assert.equal(graph.getExercise("missing"), null);
});

test("findSubstitutes returns knee-friendly squat alternatives in one traversal", () => {
  const subs = graph.findSubstitutes("exercise_back_squat", {
    conditions: ["knee_injury"],
    avoidContraindications: ["knee"]
  });
  const ids = subs.map((item) => item.id);

  assert.ok(ids.includes("exercise_box_squat"));
  assert.ok(ids.includes("exercise_leg_press"));
  // Nothing that is contraindicated for the knee slips through.
  for (const sub of subs) {
    assert.ok(!graph.getExercise(sub.id).contraindications.includes("knee"));
  }
});

test("findSubstitutes honors equipment availability", () => {
  const subs = graph.findSubstitutes("exercise_back_squat", {
    conditions: ["no_equipment", "limited_space"],
    availableEquipment: []
  });
  assert.deepEqual(
    subs.map((item) => item.id),
    ["exercise_bodyweight_squat"]
  );
});

test("searchExercises filters by muscle group and equipment", () => {
  const upperNoEquipment = graph.searchExercises({ muscleGroup: "upper", availableEquipment: [] });
  assert.ok(upperNoEquipment.every((exercise) => exercise.equipment.every((item) => item === "none")));
  assert.ok(upperNoEquipment.some((exercise) => exercise.id === "exercise_pushup"));
});

test("searchExercises excludes contraindicated movements", () => {
  const cardio = graph.searchExercises({
    movementPattern: "locomotion",
    maxImpact: "low",
    excludeContraindications: ["knee"]
  });
  const ids = cardio.map((exercise) => exercise.id);
  assert.ok(!ids.includes("exercise_zone2_run"));
  assert.ok(ids.includes("exercise_stationary_bike_z2"));
});

test("findSubstitutes is deterministic", () => {
  const a = graph.findSubstitutes("exercise_back_squat", { conditions: ["knee_injury"] });
  const b = graph.findSubstitutes("exercise_back_squat", { conditions: ["knee_injury"] });
  assert.deepEqual(a, b);
});

test("buildExerciseGraph rejects edges with missing endpoints", () => {
  assert.throws(
    () =>
      buildExerciseGraph({
        exercises: [
          {
            id: "e1",
            name: "E1",
            movementPattern: "squat",
            primaryMuscle: "quads",
            secondaryMuscles: [],
            equipment: ["none"],
            skillLevel: "beginner",
            source: "test",
            confidence: 1
          }
        ],
        edges: [{ type: "SIMILAR_TO", from: "e1", to: "ghost" }]
      }),
    /missing exercise/
  );
});
