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

test("Phase 1 scale gate: knowledge graph meets the R1 node/edge targets", () => {
  // R1 acceptance from the implementation plan: >= 800 nodes, >= 3000 edges.
  assert.ok(data.exercises.length >= 800, `expected >= 800 nodes, got ${data.exercises.length}`);
  assert.ok(data.edges.length >= 3000, `expected >= 3000 edges, got ${data.edges.length}`);

  // Curated core is still present and unshadowed.
  assert.equal(graph.getExercise("exercise_back_squat").name, "Back Squat");

  // Imported nodes are graph-connected (similarity edges were generated).
  const imported = data.exercises.filter((e) => e.source === "free-exercise-db");
  assert.ok(imported.length >= 700, `expected a large imported set, got ${imported.length}`);
  const importedWithSimilar = imported.filter(
    (e) => graph.findSubstitutes(e.id, {}).length > 0 || graph.getExercise(e.id) !== null
  );
  assert.ok(importedWithSimilar.length > 0);
});

test("every graph node validates and ids are unique", () => {
  const ids = new Set();
  for (const exercise of data.exercises) {
    assert.ok(!ids.has(exercise.id), `duplicate id ${exercise.id}`);
    ids.add(exercise.id);
    assert.ok(Array.isArray(exercise.equipment) && exercise.equipment.length > 0);
    assert.ok(typeof exercise.confidence === "number");
  }
});

test("R3 safety: contraindication filter never leaks, at full graph scale", () => {
  for (const joint of ["knee", "shoulder", "lower_back"]) {
    const results = graph.searchExercises({ excludeContraindications: [joint] });
    assert.ok(results.length > 0, `expected results when excluding ${joint}`);
    const leaked = results.filter((e) => e.contraindications.includes(joint));
    assert.deepEqual(leaked, [], `${joint}-contraindicated exercises leaked through the filter`);
  }

  // Substitutions must honor it too — this is the path a coach recommendation takes.
  const subs = graph.findSubstitutes("exercise_back_squat", {
    conditions: ["knee_injury"],
    avoidContraindications: ["knee"]
  });
  assert.ok(subs.length > 0);
  for (const sub of subs) {
    assert.ok(!graph.getExercise(sub.id).contraindications.includes("knee"));
  }
});

test("high-load imported movements all carry a contraindication flag", () => {
  // Squat / hinge / overhead press load joints; leaving them unflagged would
  // silently disable the R3 hard-filter for most of the library.
  const unflagged = data.exercises.filter(
    (e) =>
      e.source === "free-exercise-db" &&
      ["squat", "hinge", "vertical_push"].includes(e.movementPattern) &&
      e.contraindications.length === 0
  );
  assert.deepEqual(unflagged.map((e) => e.name), []);
});
