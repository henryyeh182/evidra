import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan, GOAL_TEMPLATES } from "../src/generatePlan.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("generateTrainingPlan builds a periodized multi-week plan", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });

  assert.equal(plan.userId, "user_henry_demo");
  assert.equal(plan.goalId, "goal_half_marathon");
  assert.equal(plan.periodizationType, "linear_endurance");
  assert.equal(plan.weeks.length, 4);
  assert.equal(plan.endDate, "2026-08-23");
  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["base", "build", "peak", "deload"]
  );
});

test("generateTrainingPlan caps sessions to weekday availability", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const week0 = plan.weeks[0];

  const weekdaySessions = week0.sessions.filter((session) => !/long/i.test(session.focus));
  for (const session of weekdaySessions) {
    assert.ok(session.durationMinutes <= 45, `${session.focus} should respect the 45 min cap`);
  }

  const longRun = week0.sessions.find((session) => /long/i.test(session.focus));
  assert.equal(longRun.durationMinutes, 72);
});

test("generateTrainingPlan applies injury safety constraints", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const tempo = plan.weeks[0].sessions.find((session) => session.date === "2026-07-30");

  // Active knee / high-impact restriction downgrades the tempo run.
  assert.equal(tempo.intensity, "moderate");
  assert.match(tempo.focus, /Controlled Zone 2 run/);
  assert.match(tempo.rationale, /Downgraded high-intensity run/);
});

test("generateTrainingPlan deload week reduces volume", () => {
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const base = plan.weeks[0].sessions.find((session) => session.type === "strength");
  const deload = plan.weeks[3].sessions.find((session) => session.type === "strength");

  assert.equal(plan.weeks[3].phase, "deload");
  assert.ok(deload.durationMinutes < base.durationMinutes);
});

test("generateTrainingPlan is deterministic for the golden sample user", () => {
  const a = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  const b = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  assert.deepEqual(a, b);
});

/** The same user, but their last session was `gapDays` before the plan starts. */
function contextAfterBreak(gapDays, startDate = "2026-07-27") {
  const workouts = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 90 + gapDays; i > gapDays; i -= 2) {
    const at = new Date(start);
    at.setUTCDate(at.getUTCDate() - i);
    workouts.push({
      id: `w_${i}`,
      startedAt: `${at.toISOString().slice(0, 10)}T07:00:00Z`,
      type: "run",
      durationMinutes: 45,
      trainingLoad: 70,
      rpe: 6
    });
  }
  return { ...context, workouts };
}

test("a plan that starts after a long break opens on a return ramp, not a base week", () => {
  // Without training history every plan opened at full base load, so someone
  // two months off got the identical first week to someone who trained
  // yesterday — including a high-intensity tempo run in week one.
  const plan = generateTrainingPlan(contextAfterBreak(60), { startDate: "2026-07-27", weeks: 4 });

  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["return", "return", "return", "deload"]
  );
  assert.ok(plan.weeks[0].loadMultiplier < 1, "the first week back must run under full load");
  assert.ok(
    plan.weeks[0].loadMultiplier < plan.weeks[1].loadMultiplier,
    "the ramp has to climb, not sit flat"
  );

  for (const session of plan.weeks[0].sessions) {
    assert.notEqual(session.intensity, "high", `${session.focus} should not be high intensity in week one back`);
  }

  assert.ok(
    plan.reasoning.some((line) => /Return to training/.test(line)),
    "the plan must say why it opened low"
  );
});

test("an athlete who is still training keeps the normal periodization", () => {
  const plan = generateTrainingPlan(contextAfterBreak(1), { startDate: "2026-07-27", weeks: 4 });

  assert.deepEqual(
    plan.weeks.map((week) => week.phase),
    ["base", "build", "peak", "deload"]
  );
  assert.equal(plan.weeks[0].loadMultiplier, 1, "a base week runs at full template load");
  assert.ok(
    !plan.reasoning.some((line) => /Return to training/.test(line)),
    "nobody who trained yesterday should be told to ease back"
  );
  assert.ok(
    !JSON.stringify(plan).includes("return-to-training week"),
    "no session should carry a return-to-training note"
  );
});

// --- the naming contract ---------------------------------------------------

const graphData = JSON.parse(
  await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
);
const catalog = new Map(graphData.exercises.map((exercise) => [exercise.id, exercise]));

/** The sample athlete, re-aimed at one goal so every template gets exercised. */
const withGoal = (type) => ({
  ...context,
  goals: [{ id: `goal_${type}`, type, label: type, priority: 1, targetDate: "2026-12-01" }]
});

test("every movement a plan can prescribe exists in the catalog", () => {
  // The drift this pins: the templates were authored with free-text names hours
  // before the knowledge graph chose equipment-qualified ones, and nothing
  // failed when "Bent-over Row" stopped meaning anything. An id cannot go
  // quietly wrong — it is either in the catalog or this test is red.
  const plans = ["half_marathon", "build_muscle", "general_fitness", "recovery", "lose_fat"].map(
    (goalType) => generateTrainingPlan(withGoal(goalType), { startDate: "2026-08-03", weeks: 4 })
  );

  const missing = new Set();
  for (const plan of plans) {
    for (const week of plan.weeks) {
      for (const session of week.sessions) {
        assert.ok(session.exerciseIds?.length > 0, `${session.id} prescribes nothing`);
        for (const id of session.exerciseIds) {
          if (!catalog.has(id)) missing.add(id);
        }
      }
    }
  }
  assert.deepEqual([...missing], []);
});

test("the spoken list is derived from the canonical one, never authored beside it", () => {
  const plan = generateTrainingPlan(withGoal("build_muscle"), {
    startDate: "2026-08-03",
    weeks: 2,
    displayNameFor: (id) => catalog.get(id)?.displayName || catalog.get(id)?.name || id
  });

  for (const week of plan.weeks) {
    for (const session of week.sessions) {
      assert.equal(session.exercises.length, session.exerciseIds.length);
      session.exerciseIds.forEach((id, index) => {
        assert.equal(session.exercises[index], catalog.get(id).displayName || catalog.get(id).name);
      });
    }
  }
});

test("a slot's declared equipment matches the catalog entry it points at", () => {
  // Equipment is stated on the slot so planning stays dependency-free, which
  // means it is a second copy of something the catalog already knows. This is
  // what stops the copy from drifting.
  for (const [goalType, template] of Object.entries(GOAL_TEMPLATES)) {
    for (const slot of template.slots) {
      for (const entry of slot.exercises) {
        const node = catalog.get(entry.exerciseId);
        assert.ok(node, `${goalType}: unknown exercise ${entry.exerciseId}`);
        assert.deepEqual(
          [...entry.equipment].sort(),
          [...node.equipment].sort(),
          `${goalType}: ${entry.exerciseId} equipment disagrees with the catalog`
        );
      }
    }
  }
});

test("a slot that loses its movements keeps its training goal", async () => {
  // The upper-body strength day prescribes dumbbell and barbell work. Strip the
  // equipment and every prescribed movement is filtered out — the slot used to
  // become a bodyweight squat, which is a session, but not the session that was
  // scheduled. The catalog is asked for something that still trains the slot's
  // goal before the hard-coded fallback is reached.
  const { buildExerciseGraph } = await import("../../knowledge-graph/src/graph.js");
  const graphData = JSON.parse(
    await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
  );
  const graph = buildExerciseGraph(graphData);

  const noKit = {
    ...context,
    equipment: context.equipment.map((item) => ({ ...item, available: false }))
  };
  const options = { startDate: "2026-07-27", weeks: 1 };
  const findGoalAlternative = ({ trainingGoal, availableEquipment, excludeContraindications }) =>
    graph.searchExercises({ trainingGoal, availableEquipment, excludeContraindications, limit: 1 })[0]?.id ?? null;

  const upperDay = (plan) => plan.weeks[0].sessions.find((session) => /Upper-body/.test(session.focus));

  const withoutCatalog = upperDay(generateTrainingPlan(noKit, options));
  assert.deepEqual(withoutCatalog.exerciseIds, ["exercise_bodyweight_squat"]);

  const withCatalog = upperDay(generateTrainingPlan(noKit, { ...options, findGoalAlternative }));
  const chosen = graph.getExercise(withCatalog.exerciseIds[0]);
  assert.ok(chosen, `expected a catalog movement, got ${withCatalog.exerciseIds[0]}`);
  assert.ok(
    chosen.trainingGoals.includes("strength"),
    `${chosen.id} does not train strength: ${chosen.trainingGoals.join(", ")}`
  );
  assert.ok(chosen.equipment.every((item) => ["none", "bodyweight", "outdoor"].includes(item)));
  assert.match(withCatalog.rationale, /still trains strength/);
});

test("the fallback is still reached when nothing serves the goal", () => {
  // A catalog that answers nothing must not silently produce an empty session.
  const noKit = {
    ...context,
    equipment: context.equipment.map((item) => ({ ...item, available: false }))
  };
  const plan = generateTrainingPlan(noKit, {
    startDate: "2026-07-27",
    weeks: 1,
    findGoalAlternative: () => null
  });
  const upper = plan.weeks[0].sessions.find((session) => /Upper-body/.test(session.focus));
  assert.deepEqual(upper.exerciseIds, ["exercise_bodyweight_squat"]);
  assert.match(upper.rationale, /catalog offers no strength movement/);
});
