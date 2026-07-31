import test from "node:test";
import assert from "node:assert/strict";

import { handleJsonRpcMessage } from "../src/server.js";
import { assertGrounded } from "../src/knowledgeBase.js";
import { deprecatedToolAliases, toolDefinitions } from "../src/toolDefinitions.js";

let nextId = 100;

test("public tool descriptions use canonical names", () => {
  const descriptions = toolDefinitions.flatMap((tool) => [
    tool.description,
    ...Object.values(tool.inputSchema?.properties ?? {}).map((property) => property.description)
  ]).filter(Boolean).join(" ");

  for (const alias of Object.keys(deprecatedToolAliases)) {
    assert.doesNotMatch(descriptions, new RegExp(`\\b${alias}\\b`));
  }
});

async function call(name, args = {}) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) {
    throw new Error(response.error.message);
  }
  const text = response.result.content[0].text;
  return { bytes: text.length, payload: JSON.parse(text), isError: Boolean(response.result.isError) };
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

test("evidence passed in drives the decision for a user the server has never seen", async () => {
  const evidence = {
    profile: { timezone: "Asia/Taipei", fitnessLevel: "advanced" },
    goals: [{ id: "g1", type: "half_marathon", priority: 1 }],
    constraints: { availableMinutes: 60, equipment: ["treadmill"] },
    healthMetrics: [
      { type: "hrv_ms", value: 38, recordedAt: "2026-07-27T06:00:00+08:00", source: "garmin" },
      { type: "sleep_duration_hours", value: 5.2, recordedAt: "2026-07-27T07:00:00+08:00", source: "garmin" }
    ],
    workouts: [
      {
        type: "run",
        startedAt: "2026-07-26T18:00:00+08:00",
        durationMinutes: 70,
        rpe: 8,
        trainingLoad: 112,
        muscleGroups: ["legs"],
        source: "garmin"
      }
    ]
  };

  // This id exists nowhere in the server's own files.
  const state = await call("assess_fitness_state", {
    userId: "external_user_42",
    date: "2026-07-27",
    evidence
  });
  assert.equal(state.payload.provenance.evidenceSource, "provided");
  assert.equal(state.payload.userId, "external_user_42");
  assert.equal(typeof state.payload.readinessScore, "number");

  const decision = await call("decide_session", {
    userId: "external_user_42",
    date: "2026-07-27",
    evidence,
    scheduledSession: {
      focus: "Easy run",
      type: "run",
      durationMinutes: 45,
      intensity: "moderate",
      targetMuscleGroups: ["legs"],
      exercises: ["exercise_tempo_run"]
    }
  });

  assert.equal(decision.payload.provenance.evidenceSource, "provided");
  assert.ok(decision.payload.action.from, "a scheduled session was found for the external user");
  assert.ok(decision.payload.reason.length > 0);
});

test("without evidence the server asks for evidence instead of answering", async () => {
  // Found driving the real server from Claude Desktop: with no health source
  // connected the host sent a userId and no evidence, the seed guard threw, and
  // the user saw "Failed to call tool". A caller that has not sent evidence yet
  // is a state of the conversation, not a fault — so it comes back as a tool
  // error the model can read and act on, naming what to go and fetch.
  for (const tool of ["assess_fitness_state", "decide_session", "generate_plan"]) {
    const { payload, isError } = await call(tool, { userId: "someone_real" });

    assert.equal(isError, true, `${tool} reports this as a tool error`);
    assert.equal(payload.error, "evidence_required");
    assert.equal(payload.tool, tool);
    assert.ok(Object.keys(payload.accepts).length > 0, `${tool} says what it accepts`);
  }
});

test("evidence in the wrong shape comes back correctable, not fatal", async () => {
  // Found driving the real server from Claude Desktop: the host assembled
  // evidence, got a field wrong, and three calls in a row came back as bare
  // JSON-RPC errors. The user saw "Failed to call tool" and the host gave up
  // rather than fixing its payload — it never learned which field was wrong.
  const wrongCase = await call("decide_session", {
    evidence: { healthMetrics: [{ type: "sleepDurationHours", value: 7, recordedAt: "2026-07-31T00:00:00Z" }] }
  });

  assert.equal(wrongCase.isError, true);
  assert.equal(wrongCase.payload.error, "invalid_evidence");
  assert.match(wrongCase.payload.problem, /sleepDurationHours/);
  // The canonical names have to be in the reply, or the next attempt is another guess.
  assert.match(wrongCase.payload.shape["evidence.healthMetrics[]"].type, /sleep_duration_hours/);

  const missingField = await call("assess_fitness_state", {
    evidence: { workouts: [{ type: "run", durationMinutes: 45, trainingLoad: 62 }] }
  });

  assert.equal(missingField.isError, true);
  assert.match(missingField.payload.problem, /startedAt/);
});

test("a ratio built on almost no history says so", async () => {
  // Also found in the field: one session of evidence produced an acute:chronic
  // ratio of 0.17, which reads as severe detraining and meant only that the
  // evidence was one day deep. The host happened to catch it; the contract
  // has to carry it instead of relying on that.
  const { payload } = await call("decide_session", {
    evidence: {
      profile: { timezone: "Asia/Taipei" },
      healthMetrics: [{ type: "sleep_duration_hours", value: 7, recordedAt: "2026-07-31T00:00:00Z" }],
      workouts: [{ startedAt: "2026-07-30T10:00:00Z", durationMinutes: 45, type: "run", trainingLoad: 62 }]
    },
    date: "2026-07-31",
    scheduledSession: { type: "run", focus: "VO2max Intervals", intensity: "high", durationMinutes: 60 }
  });

  const caveat = payload.limits.find((line) => line.includes("acute:chronic ratio"));
  assert.ok(caveat, "the thin-history caveat travels with the ratio");
  assert.match(caveat, /1 day of evidence \(1 session\)/);
  assert.ok(payload.limits.some((line) => line.includes("assumed weekly target")));
});

test("the demo seed cannot reach a real caller's answer by falling back", async () => {
  // The seed is another person's numbers. It stays reachable for local runs,
  // but only by asking for it outright, and that flag is not in the public
  // schema — so no production call can arrive at it by omission.
  const askedFor = await call("assess_fitness_state", { useDemoSeed: true, date: "2026-07-23" });
  assert.equal(askedFor.isError, false);
  assert.equal(askedFor.payload.provenance.evidenceSource, "demo_seed");

  const publicSchema = toolDefinitions.find((tool) => tool.name === "assess_fitness_state").inputSchema;
  assert.equal(publicSchema.properties.useDemoSeed, undefined);
  assert.deepEqual(publicSchema.required, ["evidence"]);
});

test("a substitution takes the movement as the user said it, not only as an id", async () => {
  // Regression, found running the real MCP server: agents pass the movement the
  // way their user named it, and the handler took canonical ids alone — so
  // "back squat" came back as a tool error the user could see.
  const spoken = await call("decide_exercise_substitution", {
    exerciseId: "back squat",
    conditions: ["knee_injury"],
    availableEquipment: ["dumbbell"],
    avoidContraindications: ["knee"]
  });
  const canonical = await call("decide_exercise_substitution", {
    exerciseId: "exercise_back_squat",
    conditions: ["knee_injury"],
    availableEquipment: ["dumbbell"],
    avoidContraindications: ["knee"]
  });

  assert.equal(spoken.payload.action.from.exercise_id, "exercise_back_squat");
  assert.deepEqual(spoken.payload.action, canonical.payload.action, "both spellings decide the same thing");
});

test("an unresolvable movement says what form the argument takes", async () => {
  await assert.rejects(
    () => call("decide_exercise_substitution", { exerciseId: "interpretive dance" }),
    /canonical exercise_\* id/
  );
});
