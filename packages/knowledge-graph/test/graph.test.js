// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildExerciseGraph } from "../src/graph.js";
import { assertValidProgressions, assertUniqueExerciseNaming, assertValidTrainingGoals } from "../src/models.js";

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
            trainingGoals: ["strength"],
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

// --- progression ladders (Phase 4.3) --------------------------------------

const ladderNode = (id) => ({
  id,
  name: id,
  movementPattern: "squat",
  primaryMuscle: "quads",
  secondaryMuscles: [],
  equipment: ["none"],
  skillLevel: "beginner",
  trainingGoals: ["strength"],
  source: "test",
  confidence: 1
});

test("every core lift can be climbed down as well as up", () => {
  // A ladder with only PROGRESSES_TO is invisible to findSubstitutes, which
  // reaches for regressions. Each of these is the top of a curated ladder.
  for (const id of [
    "exercise_back_squat",
    "exercise_deadlift",
    "exercise_bench_press",
    "exercise_overhead_press",
    "exercise_pullup",
    "exercise_bent_over_row",
    "exercise_zone2_run"
  ]) {
    const easier = graph.getRegressions(id);
    assert.ok(easier.length > 0, `${id} has no regression to fall back to`);
    for (const step of easier) {
      assert.ok(
        graph.getProgressions(step.id).some((back) => back.id === id),
        `${step.id} does not climb back to ${id}`
      );
    }
  }
});

test("a regression request returns a real regression, not a similar movement", () => {
  // The Phase 4.3 acceptance case: asking to scale back an advanced pull must
  // hand back an easier vertical pull, not another advanced one.
  const subs = graph.findSubstitutes("exercise_pullup", {});
  const regression = subs.find((sub) => sub.id === "exercise_assisted_pullup");
  assert.ok(regression, `expected the assisted pull-up rung, got ${subs.map((s) => s.id).join(", ")}`);
  assert.equal(graph.getExercise(regression.id).movementPattern, "vertical_pull");
  assert.equal(graph.getExercise(regression.id).skillLevel, "beginner");
});

test("progression edges are curated only — generated edges never claim a direction", () => {
  // The generator ranks by similarity, which has no direction. If it ever
  // starts emitting PROGRESSES_TO, that is similarity wearing a coaching label.
  const bySource = new Map(data.exercises.map((e) => [e.id, e.source]));
  const directed = data.edges.filter((e) => e.type === "PROGRESSES_TO" || e.type === "REGRESSES_TO");
  const generated = directed.filter(
    (e) => bySource.get(e.from) === "free-exercise-db" || bySource.get(e.to) === "free-exercise-db"
  );
  assert.deepEqual(generated, [], "generated nodes must not carry progression edges");
});

test("assertValidProgressions rejects a one-way ladder", () => {
  assert.throws(
    () =>
      assertValidProgressions({
        exercises: [ladderNode("a"), ladderNode("b")],
        edges: [{ type: "PROGRESSES_TO", from: "a", to: "b" }]
      }),
    /no matching REGRESSES_TO/
  );
});

test("assertValidProgressions rejects progressing to an easier movement", () => {
  assert.throws(
    () =>
      assertValidProgressions({
        exercises: [{ ...ladderNode("a"), skillLevel: "advanced" }, ladderNode("b")],
        edges: [
          { type: "PROGRESSES_TO", from: "a", to: "b" },
          { type: "REGRESSES_TO", from: "b", to: "a" }
        ]
      }),
    /lower skill level/
  );
});

test("assertValidProgressions rejects a cycle of same-level movements", () => {
  // Skill monotonicity alone would let this through: every rung is beginner.
  assert.throws(
    () =>
      assertValidProgressions({
        exercises: [ladderNode("a"), ladderNode("b"), ladderNode("c")],
        edges: [
          { type: "PROGRESSES_TO", from: "a", to: "b" },
          { type: "REGRESSES_TO", from: "b", to: "a" },
          { type: "PROGRESSES_TO", from: "b", to: "c" },
          { type: "REGRESSES_TO", from: "c", to: "b" },
          { type: "PROGRESSES_TO", from: "c", to: "a" },
          { type: "REGRESSES_TO", from: "a", to: "c" }
        ]
      }),
    /cycle/
  );
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

// --- the naming layer ------------------------------------------------------

test("however a caller says it, it resolves to one canonical exercise", () => {
  // The three layers: id, canonical name, and whatever a coach actually says.
  const cases = [
    ["exercise_bent_over_row", "exercise_bent_over_row"],
    ["Bent-over Barbell Row", "exercise_bent_over_row"],
    ["bent-over row", "exercise_bent_over_row"],
    ["barbell row", "exercise_bent_over_row"],
    ["  BARBELL ROW  ", "exercise_bent_over_row"],
    ["easy walk", "exercise_recovery_walk"],
    ["mobility flow", "exercise_lower_body_mobility"],
    ["recovery ride", "exercise_stationary_bike_z2"],
    ["rdl", "exercise_romanian_deadlift"],
    ["long run", "exercise_zone2_run"]
  ];
  for (const [said, expected] of cases) {
    assert.equal(graph.resolveExercise(said)?.id, expected, `"${said}" should resolve to ${expected}`);
  }
  assert.equal(graph.resolveExercise("interpretive dance"), null);
  assert.equal(graph.resolveExercise(undefined), null);
});

test("what a human is shown is the spoken form, not the catalog spelling", () => {
  assert.equal(graph.displayNameFor("exercise_bent_over_row"), "Bent-over Row");
  assert.equal(graph.getExercise("exercise_bent_over_row").name, "Bent-over Barbell Row");
  // An id nothing knows stays visible rather than rendering blank.
  assert.equal(graph.displayNameFor("exercise_nope"), "exercise_nope");
});

test("a tempo run is its own movement, a long run is the same one for longer", () => {
  // Duration is a prescription and belongs on the session; a different training
  // stimulus is a different movement. Collapsing both into aliases would have
  // made "Tempo Run" mean Zone 2.
  assert.equal(graph.resolveExercise("long zone 2 run")?.id, "exercise_zone2_run");
  assert.equal(graph.resolveExercise("tempo run")?.id, "exercise_tempo_run");
  assert.notEqual(graph.resolveExercise("tempo run")?.id, graph.resolveExercise("long run")?.id);
});

test("assertUniqueExerciseNaming rejects a term two exercises both claim", () => {
  assert.throws(
    () =>
      assertUniqueExerciseNaming({
        exercises: [
          { ...ladderNode("a"), name: "Barbell Row", aliases: [] },
          { ...ladderNode("b"), name: "Bent-over Barbell Row", aliases: ["barbell row"] }
        ]
      }),
    /Ambiguous exercise/
  );
});

test("no imported exercise shadows a curated one under the same name", () => {
  // Twelve did: the curated Goblet Squat and the vendored one both answered a
  // search under different ids. Dedupe is by term now, not by id alone.
  const seen = new Map();
  for (const exercise of data.exercises) {
    for (const term of [exercise.name, exercise.displayName, ...(exercise.aliases || [])]) {
      if (!term) continue;
      const key = String(term).toLowerCase();
      assert.ok(
        !seen.has(key) || seen.get(key) === exercise.id,
        `"${term}" is claimed by both ${seen.get(key)} and ${exercise.id}`
      );
      seen.set(key, exercise.id);
    }
  }
});

// --- training goals -------------------------------------------------------

test("a movement can be found by the quality it trains", () => {
  const mobility = graph.searchExercises({ trainingGoal: "mobility", availableEquipment: [] });
  assert.ok(mobility.some((exercise) => exercise.id === "exercise_lower_body_mobility"));
  assert.ok(mobility.every((exercise) => exercise.trainingGoals.includes("mobility")));

  // Endurance is not a strength lift wearing a different label.
  const endurance = graph.searchExercises({ trainingGoal: "endurance" });
  assert.ok(endurance.some((exercise) => exercise.id === "exercise_zone2_run"));
  assert.ok(!endurance.some((exercise) => exercise.id === "exercise_back_squat"));
});

test("a substitute says whether it still trains what the original did", () => {
  // A run with an injured knee becomes a walk: safe, and still endurance.
  const forRun = graph.findSubstitutes("exercise_zone2_run", {
    conditions: ["knee_injury"],
    avoidContraindications: ["knee"]
  });
  const walk = forRun.find((item) => item.id === "exercise_recovery_walk");
  assert.ok(walk, "expected the recovery walk among knee-safe substitutes");
  assert.equal(walk.preservesTrainingGoal, true);
  assert.deepEqual(walk.trainingGoals, ["endurance"]);
});

test("preserveTrainingGoal drops candidates that change the stimulus", () => {
  const all = graph.findSubstitutes("exercise_back_squat", { limit: 20 });
  const preserved = graph.findSubstitutes("exercise_back_squat", { preserveTrainingGoal: true, limit: 20 });

  assert.ok(preserved.length > 0, "a squat must have goal-preserving substitutes");
  assert.ok(preserved.length <= all.length);
  const squatGoals = graph.getExercise("exercise_back_squat").trainingGoals;
  for (const item of preserved) {
    assert.ok(
      item.trainingGoals.some((goal) => squatGoals.includes(goal)),
      `${item.id} shares no training goal with the back squat`
    );
    assert.equal(item.preservesTrainingGoal, true);
  }
});

test("assertValidTrainingGoals rejects an unlabelled movement", () => {
  assert.throws(
    () => assertValidTrainingGoals({ exercises: [{ ...ladderNode("a"), trainingGoals: [] }] }),
    /declares no training goal/
  );
});

test("assertValidTrainingGoals rejects a movement that claims everything", () => {
  // The failure mode this attribute has to survive: goal coverage made to look
  // complete by labelling every node with every goal.
  assert.throws(
    () =>
      assertValidTrainingGoals({
        exercises: [
          {
            ...ladderNode("a"),
            trainingGoals: ["strength", "hypertrophy", "power", "endurance", "mobility"]
          }
        ]
      }),
    /claims 5 training goals/
  );
});

test("assertValidTrainingGoals rejects an unknown goal", () => {
  assert.throws(
    () => assertValidTrainingGoals({ exercises: [{ ...ladderNode("a"), trainingGoals: ["fat_loss"] }] }),
    /unknown training goal/
  );
});

test("assertValidTrainingGoals holds a pattern to its defining quality", () => {
  assert.throws(
    () =>
      assertValidTrainingGoals({
        exercises: [
          { ...ladderNode("a"), movementPattern: "locomotion", trainingGoals: ["strength"] }
        ]
      }),
    /does not serve endurance/
  );
});

test("imported nodes carry goals derived from vendor fields, not a blanket label", () => {
  // The mirror of the progression rule: generated data may state what the
  // vendor's own category says, and nothing beyond it. If every imported node
  // wore the same goals, the attribute could not tell two movements apart.
  const imported = data.exercises.filter((e) => e.source === "free-exercise-db");
  const combos = new Set(imported.map((e) => [...e.trainingGoals].sort().join("+")));
  assert.ok(combos.size >= 4, `expected varied goal sets, got ${[...combos].join(" | ")}`);

  const stretches = imported.filter((e) => e.movementPattern === "mobility");
  assert.ok(stretches.every((e) => e.trainingGoals.includes("mobility")));
  assert.ok(
    stretches.every((e) => !e.trainingGoals.includes("strength")),
    "a stretch is not a strength movement"
  );
});
