// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

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
  return {
    // What the model actually receives, which is the whole result frame: a
    // structured payload is sent alongside the text block, so measuring the text
    // alone would have quietly stopped measuring half of it.
    bytes: JSON.stringify(response.result).length,
    payload: JSON.parse(text),
    structured: response.result.structuredContent,
    isError: Boolean(response.result.isError)
  };
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
    assert.ok(bytes <= 4096, `result frame of ${bytes} bytes exceeds the ~4KB budget`);
  }
});

test("a structured result costs its payload twice, and only where a schema is declared", async () => {
  // The protocol asks for the serialized JSON in a text block as well, so a tool
  // that declares an output schema sends the payload twice. That is the price of
  // a client that predates structured results still seeing an answer — but it is
  // a real price, so the frame gets its own ceiling instead of going unmeasured.
  const decision = await call("evidra_decide_session", {
    evidence: WORKING_EVIDENCE,
    scheduledSession: { focus: "intervals", type: "run", durationMinutes: 60, intensity: "high" }
  });

  assert.ok(decision.structured, "an advertised tool answers with a structured result");
  // Compared as it goes on the wire: the payload carries keys whose value is
  // undefined, which serializing drops from both copies but which an in-process
  // comparison would report as a difference that no client can observe.
  assert.deepEqual(
    JSON.parse(JSON.stringify(decision.structured)),
    decision.payload,
    "the two copies say the same thing"
  );
  assert.ok(
    decision.bytes <= FRAME_CEILING,
    `result frame of ${decision.bytes} bytes exceeds the ${FRAME_CEILING}-byte ceiling`
  );

  // A tool with no declared schema gets no structured copy, so nothing pays
  // twice for a shape no contract covers.
  const deprecated = await call("get_user_profile", { userId: "user_henry_demo" });
  assert.equal(deprecated.structured, undefined);
});

/**
 * The ceiling, and why it is this number.
 *
 * It is a budget we set, not a limit anyone published — the submission
 * checklist says only "keep responses reasonably sized for the task". The
 * previous 8192 came from "payload ~4KB, sent twice" and was chosen before
 * decisions carried their evidentiary basis. Each value since has been set above
 * the measured worst case below, with headroom; none is a finding and none must
 * be cited as one.
 *
 * What pushes a decision to the top of the range is the two rules that carry
 * citations — the acute:chronic rule ships Gabbett 2016 plus the Impellizzeri
 * and Lolli objections, and detraining ships Mujika and Padilla. Trimming to
 * hold a rounder number would mean cutting exactly the material that lets those
 * rules be checked, which is the wrong trade.
 *
 * 12288 became 13312 on 2026-08-08, when verificationStatus became mandatory on
 * `contested` and the check found both objections on the acute:chronic rule
 * overstated. Correcting them cost bytes in the worst case here: the Lolli
 * citation had carried no title and did not resolve to a single record, so it
 * gained one, and both entries now declare how far they were read. That is the
 * material the paragraph above says not to trade away, so the budget moved
 * instead of the provenance. The objections themselves were shortened as far as
 * they could go while still saying what each paper argues, and the verbatim
 * abstract quotations were moved into session-rules.json's verification blocks,
 * which a reviewer reads directly and no decision frame carries.
 */
const FRAME_CEILING = 13312;

/**
 * The ceiling has to be tested against the worst case, not a convenient one.
 *
 * The test above passes on a fixture whose governing rule happens to be one of
 * the six with no citations to carry. It went on passing while the real worst
 * case sat 3KB over the old ceiling, because nothing drove a decision that the
 * acute:chronic rule governs. A ceiling only one fixture can reach is not a
 * ceiling.
 */
test("the frame ceiling holds for the decisions that carry the most provenance", async () => {
  const day = (n) => new Date(Date.UTC(2026, 7, 6) - n * 86400000).toISOString().slice(0, 10);
  const run = (n, load) => ({
    type: "run",
    startedAt: `${day(n)}T07:00:00Z`,
    durationMinutes: 60,
    trainingLoad: load,
    source: "garmin"
  });
  const recovery = [
    { type: "hrv_ms", value: 43, unit: "ms", recordedAt: "2026-08-06T06:00:00Z", source: "garmin" },
    { type: "sleep_duration_hours", value: 7.2, unit: "hours", recordedAt: "2026-08-06T06:00:00Z", source: "garmin" },
    { type: "resting_hr_bpm", value: 54, unit: "bpm", recordedAt: "2026-08-06T06:00:00Z", source: "garmin" },
    { type: "stress", value: 30, unit: "0-100", recordedAt: "2026-08-06T06:00:00Z", source: "garmin" }
  ];
  const scheduledSession = {
    focus: "VO2max Intervals",
    type: "run",
    durationMinutes: 60,
    intensity: "high",
    targetMuscleGroups: ["legs"]
  };

  // Thin history is the expensive shape, not an exotic one: a caller who has
  // only just connected a source lands here, and the decision then carries both
  // the rule's own provenance and two extra caveats about how little history
  // the ratio rests on.
  const worstCases = [
    {
      name: "acute:chronic spike on thin history",
      expectGoverning: "EVD-R-006",
      evidence: { healthMetrics: recovery, workouts: [1, 2, 3, 4, 5].map((n) => run(n, 220)) }
    },
    {
      name: "acute:chronic spike on a full chronic window",
      expectGoverning: "EVD-R-006",
      evidence: {
        healthMetrics: recovery,
        workouts: Array.from({ length: 24 }, (_, i) => run(i + 1, i < 6 ? 400 : 60))
      }
    },
    {
      name: "return from a long break",
      expectGoverning: "EVD-R-007",
      evidence: {
        healthMetrics: recovery,
        workouts: Array.from({ length: 12 }, (_, i) => run(i + 70, 300))
      }
    }
  ];

  for (const testCase of worstCases) {
    const result = await call("evidra_decide_session", {
      evidence: testCase.evidence,
      date: "2026-08-06",
      scheduledSession
    });

    // Assert the case still drives the rule it was built to drive. Without this
    // the ceiling could go on passing because the case quietly stopped
    // exercising the expensive path — the exact failure this test replaces.
    assert.equal(
      result.payload.decisionBasis.governingRule?.ruleId,
      testCase.expectGoverning,
      `${testCase.name} no longer reaches ${testCase.expectGoverning}, so it is not testing the worst case`
    );
    assert.ok(
      result.bytes <= FRAME_CEILING,
      `${testCase.name}: frame of ${result.bytes} bytes exceeds the ${FRAME_CEILING}-byte ceiling`
    );
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
  const state = await call("evidra_assess_fitness_state", {
    userId: "external_user_42",
    date: "2026-07-27",
    evidence
  });
  assert.equal(state.payload.provenance.evidenceSource, "provided");
  assert.equal(state.payload.userId, "external_user_42");
  assert.equal(typeof state.payload.readinessScore, "number");

  const decision = await call("evidra_decide_session", {
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
  for (const tool of ["evidra_assess_fitness_state", "evidra_decide_session", "evidra_generate_plan"]) {
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
  const wrongCase = await call("evidra_decide_session", {
    evidence: { healthMetrics: [{ type: "sleepDurationHours", value: 7, recordedAt: "2026-07-31T00:00:00Z" }] }
  });

  assert.equal(wrongCase.isError, true);
  assert.equal(wrongCase.payload.error, "invalid_evidence");
  assert.match(wrongCase.payload.problem, /sleepDurationHours/);
  // The canonical names have to be in the reply, or the next attempt is another guess.
  assert.match(wrongCase.payload.shape["evidence.healthMetrics[]"].type, /sleep_duration_hours/);

  const missingField = await call("evidra_assess_fitness_state", {
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
  const { payload } = await call("evidra_decide_session", {
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
  assert.match(caveat, /1 day of history \(1 session\)/);
  // Both facts still reach the athlete, but as one sentence. Said as two they
  // ran to ninety words about a number that was never what they asked about.
  assert.match(caveat, /assumed weekly target/);
  assert.equal(
    payload.limits.filter((line) => line.includes("assumed weekly target")).length,
    1,
    "the two halves of the same caveat are said once, not twice"
  );
});

test("the demo seed cannot reach a real caller's answer by falling back", async () => {
  // The seed is another person's numbers. It stays reachable for local runs,
  // but only by asking for it outright, and that flag is not in the public
  // schema — so no production call can arrive at it by omission.
  const askedFor = await call("evidra_assess_fitness_state", { useDemoSeed: true, date: "2026-07-23" });
  assert.equal(askedFor.isError, false);
  assert.equal(askedFor.payload.provenance.evidenceSource, "demo_seed");

  const publicSchema = toolDefinitions.find((tool) => tool.name === "evidra_assess_fitness_state").inputSchema;
  assert.equal(publicSchema.properties.useDemoSeed, undefined);
  assert.deepEqual(publicSchema.required, ["evidence"]);
});

test("a refusal carries the way out, and says it is not an answer to read aloud", async () => {
  // Regression, found in Claude Desktop on v0.3.0: asked whether to run today's
  // intervals, the host answered "I have no data, anything I say now is made
  // up" and stopped. Nothing was broken — the refusal simply stated what this
  // server will not do, in a sentence that reads perfectly well aloud, so it
  // was read aloud. The athlete was never asked the three questions that would
  // have produced a decision.
  for (const tool of ["evidra_assess_fitness_state", "evidra_decide_session", "evidra_generate_plan"]) {
    const { isError, payload } = await call(tool, {});
    assert.ok(isError, `${tool} should refuse a call with no evidence`);
    assert.match(payload.audience, /not an answer to relay/, `${tool} must mark the payload as the caller's`);
    assert.ok(payload.callerAction, `${tool} must say what to do next`);
    assert.match(payload.callerAction, /ask them/, `${tool} must offer asking the athlete as a path`);
    // The sentence that became "anything I say now is made up".
    assert.doesNotMatch(
      JSON.stringify(payload),
      /does not fetch, store, or invent/,
      `${tool} must not answer a failed call with a statement of what the server declines to do`
    );
  }
});

test("a substitution takes the movement as the user said it, not only as an id", async () => {
  // Regression, found running the real MCP server: agents pass the movement the
  // way their user named it, and the handler took canonical ids alone — so
  // "back squat" came back as a tool error the user could see.
  const spoken = await call("evidra_decide_exercise_substitution", {
    exerciseId: "back squat",
    conditions: ["knee_injury"],
    availableEquipment: ["dumbbell"],
    avoidContraindications: ["knee"]
  });
  const canonical = await call("evidra_decide_exercise_substitution", {
    exerciseId: "exercise_back_squat",
    conditions: ["knee_injury"],
    availableEquipment: ["dumbbell"],
    avoidContraindications: ["knee"]
  });

  assert.equal(spoken.payload.action.from.exercise_id, "exercise_back_squat");
  assert.deepEqual(spoken.payload.action, canonical.payload.action, "both spellings decide the same thing");
});

test("an unresolvable movement says what form the argument takes", async () => {
  const { payload, isError } = await call("evidra_decide_exercise_substitution", { exerciseId: "interpretive dance" });

  // Asserted as a tool error, not a rejection: this used to throw, and the
  // rejection assertion was what kept it throwing. A caller that sent a movement
  // nobody stocks has to be able to read why and ask the user again.
  assert.equal(isError, true, "the tool ran and could not answer — a tool error, not a protocol error");
  assert.equal(payload.error, "unknown_exercise");
  assert.match(payload.shape.exerciseId, /canonical exercise_\* id/);
});

test("a plan tool called without the caller's plan says what to send", async () => {
  for (const [tool, args, expected] of [
    ["evidra_preview_adjust_plan", { changeRequest: { kind: "deload_week", weekIndex: 0 } }, "plan_required"],
    ["evidra_commit_adjust_plan", { preview: {} }, "plan_state_required"],
    ["evidra_commit_adjust_plan", { plan: {} }, "plan_state_required"]
  ]) {
    const { payload, isError } = await call(tool, args);

    assert.equal(isError, true, `${tool} reports missing plan state as a tool error`);
    assert.equal(payload.error, expected);
    // The server holds no plan, so the reply is the only place the caller can
    // learn what it is expected to hold.
    assert.match(payload.shape.plan, /caller-held|current caller-held/);
  }
});

test("a change the plan cannot carry comes back refused, not thrown", async () => {
  const plan = (await call("evidra_generate_plan", { evidence: WORKING_EVIDENCE, weeks: 2 })).payload;

  const unknownKind = await call("evidra_preview_adjust_plan", { plan, changeRequest: { kind: "make_it_easier" } });
  assert.equal(unknownKind.isError, true);
  assert.equal(unknownKind.payload.error, "plan_change_refused");
  assert.match(unknownKind.payload.problem, /make_it_easier/);

  // Optimistic concurrency: a preview built against an older version is refused,
  // and the refusal has to say so — taking a fresh preview is a one-turn fix.
  const preview = (await call("evidra_preview_adjust_plan", { plan, changeRequest: { kind: "deload_week", weekIndex: 0 } }))
    .payload.patch;
  const stale = await call("evidra_commit_adjust_plan", { plan: { ...plan, version: plan.version + 1 }, preview });
  assert.equal(stale.isError, true);
  assert.equal(stale.payload.error, "commit_refused");
  assert.match(stale.payload.problem, /stale/);
});

// The evidence a caller has to get right is not only the metric arrays: `date`
// and `profile.timezone` are caller-supplied strings too, and both used to
// escape the guard above and surface as bare JSON-RPC errors. Found by replaying
// a real Claude Desktop session — three "Failed to call tool" toasts in a row,
// after which the host stopped using the tools and answered from its own
// judgement instead. Anything a caller can correct has to come back correctable.
const WORKING_EVIDENCE = {
  healthMetrics: [{ type: "sleep_duration_hours", value: 7, recordedAt: "2026-07-31T00:00:00Z" }],
  workouts: [{ startedAt: "2026-07-30T10:00:00Z", durationMinutes: 45, type: "run", trainingLoad: 62 }]
};

test("a date written the way a person says it is correctable, not fatal", async () => {
  for (const [tool, argument] of [
    ["evidra_assess_fitness_state", "date"],
    ["evidra_decide_session", "date"],
    ["evidra_generate_plan", "startDate"]
  ]) {
    // "today" is what an agent writes when it has not been told the format;
    // "2026-8-1" is the same date with the zero-padding dropped. Both reached
    // the load curve and threw `Invalid time value`.
    for (const written of ["today", "2026-8-1", "Aug 1, 2026", "2026-08-32"]) {
      const { payload, isError } = await call(tool, {
        evidence: WORKING_EVIDENCE,
        [argument]: written
      });

      assert.equal(isError, true, `${tool} reports ${written} as a tool error`);
      assert.equal(payload.error, "invalid_date");
      // The format has to be in the reply, or the next attempt is another guess.
      assert.match(payload.shape[argument], /YYYY-MM-DD/);
    }
  }
});

test("the dates that already worked keep working", async () => {
  // The guard must not narrow what callers may send. A full ISO instant is
  // read for its calendar day exactly as before, and an absent date still means
  // "the server works today out" — that resolution is the server's job (P5).
  for (const date of ["2026-07-31", "2026-07-31T13:00:00+08:00", "", null, undefined]) {
    const { isError } = await call("evidra_decide_session", { evidence: WORKING_EVIDENCE, date });
    assert.equal(isError, false, `date ${JSON.stringify(date)} still answers`);
  }
});

test("a timezone that is not an IANA name is correctable, not fatal", async () => {
  // "Taipei" and "GMT+8" are one spelling away from a zone that works, and the
  // day cannot be resolved without one — so this is reported like any other
  // unreadable evidence, naming the form that would have worked.
  for (const timezone of ["Taipei", "GMT+8", "Mars/Olympus"]) {
    const { payload, isError } = await call("evidra_assess_fitness_state", {
      evidence: { ...WORKING_EVIDENCE, profile: { timezone } }
    });

    assert.equal(isError, true, `${timezone} reports as a tool error`);
    assert.equal(payload.error, "invalid_evidence");
    assert.match(payload.problem, /IANA/);
    assert.match(payload.shape["evidence.profile"].timezone, /Asia\/Taipei/);
  }

  const usable = await call("evidra_assess_fitness_state", {
    evidence: { ...WORKING_EVIDENCE, profile: { timezone: "Asia/Taipei" } }
  });
  assert.equal(usable.isError, false, "a real zone still answers");
});
