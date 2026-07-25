import test from "node:test";
import assert from "node:assert/strict";

import { handleJsonRpcMessage } from "../src/server.js";
import { assertGrounded } from "../src/knowledgeBase.js";

let nextId = 100;
async function call(name, args = {}) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) {
    throw new Error(response.error.message);
  }
  const text = response.result.content[0].text;
  return { bytes: text.length, payload: JSON.parse(text) };
}

test("search_exercises answers a structured query and grounds every result", async () => {
  const { payload } = await call("search_exercises", {
    muscleGroup: "lower",
    availableEquipment: [],
    excludeContraindications: ["knee"],
    limit: 10
  });

  assert.ok(payload.total > 0);
  for (const item of payload.results) {
    assert.ok(item.exercise_id.startsWith("exercise_"), "every hit carries a verifiable id");
    // Bodyweight-only was requested.
    assert.ok(item.equipment.every((eq) => ["none", "bodyweight", "outdoor"].includes(eq)));
    // R3 hard filter must hold at the API boundary, not just in the graph.
    assert.ok(!item.contraindications.includes("knee"));
  }
});

test("search_exercises paginates deterministically", async () => {
  const first = await call("search_exercises", { muscleGroup: "lower", limit: 5, offset: 0 });
  const second = await call("search_exercises", { muscleGroup: "lower", limit: 5, offset: 5 });

  assert.equal(first.payload.results.length, 5);
  assert.equal(first.payload.hasMore, true);
  const firstIds = first.payload.results.map((item) => item.exercise_id);
  const secondIds = second.payload.results.map((item) => item.exercise_id);
  assert.deepEqual(firstIds.filter((id) => secondIds.includes(id)), [], "pages must not overlap");
});

test("get_exercise returns graph neighbours and knee-safe substitutes", async () => {
  const { payload } = await call("get_exercise", {
    exerciseId: "exercise_back_squat",
    conditions: ["knee_injury"],
    avoidContraindications: ["knee"]
  });

  assert.equal(payload.exercise_id, "exercise_back_squat");
  assert.ok(payload.substitutes.length > 0);
  const names = payload.substitutes.map((item) => item.name);
  assert.ok(names.includes("Box Squat") || names.includes("Leg Press"));
  for (const sub of payload.substitutes) {
    assert.ok(sub.reason.length > 0, "substitutes explain themselves");
  }
});

test("get_exercise rejects an unknown id instead of inventing one", async () => {
  await assert.rejects(() => call("get_exercise", { exerciseId: "exercise_does_not_exist" }), /Unknown exercise/);
});

test("search_workouts answers the all-Zone-2 query Peloton could not", async () => {
  const { payload } = await call("search_workouts", { inZone: 2 });
  assert.ok(payload.total >= 1);
  assert.ok(payload.results.every((workout) => workout.workout_id.startsWith("workout_")));
});

test("get_workout returns Block/Set structure, never prose", async () => {
  const { payload } = await call("get_workout", { workoutId: "workout_zone2_base_run" });

  assert.ok(Array.isArray(payload.blocks) && payload.blocks.length > 0);
  for (const block of payload.blocks) {
    assert.ok(typeof block.kind === "string");
    for (const set of block.sets) {
      // Each set resolves to a real exercise, so nothing can be narrated from thin air.
      assert.ok(set.exercise_id.startsWith("exercise_"));
      assert.ok(set.exerciseName, "set resolves to a named exercise");
    }
  }
  assert.equal(payload.description, undefined, "no prose blob is returned");
});

test("get_training_history sorts newest-first on the server", async () => {
  const { payload } = await call("get_training_history", { userId: "user_henry_demo" });

  assert.equal(payload.sort, "startedAt_desc");
  const times = payload.results.map((item) => new Date(item.startedAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "server owns the ordering");
});

test("get_user_profile exposes the constraints a recommendation must respect", async () => {
  const { payload } = await call("get_user_profile", { userId: "user_henry_demo" });

  assert.equal(payload.userId, "user_henry_demo");
  assert.ok(Array.isArray(payload.goals) && payload.goals.length > 0);
  assert.ok(Array.isArray(payload.activeInjuries));
  assert.ok(payload.availableEquipment.includes("dumbbell"));
});

test("read payloads stay inside the cross-model size budget", async () => {
  const calls = [
    await call("search_exercises", { muscleGroup: "lower", limit: 20 }),
    await call("get_exercise", { exerciseId: "exercise_back_squat" }),
    await call("search_workouts", {}),
    await call("get_workout", { workoutId: "workout_zone2_base_run" }),
    await call("get_user_profile", { userId: "user_henry_demo" }),
    await call("get_training_history", { userId: "user_henry_demo", limit: 20 })
  ];
  for (const { bytes } of calls) {
    assert.ok(bytes <= 4096, `payload of ${bytes} bytes exceeds the ~4KB budget`);
  }
});

test("assertGrounded rejects a payload that references a missing exercise (P3)", () => {
  const fakeGraph = { exists: (id) => id === "exercise_real" };
  assert.doesNotThrow(() => assertGrounded({ sets: [{ exercise_id: "exercise_real" }] }, fakeGraph));
  assert.throws(
    () => assertGrounded({ sets: [{ exercise_id: "exercise_ghost" }] }, fakeGraph),
    /Ungrounded exercise reference/
  );
});
