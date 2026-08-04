// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { decideSession, RULES } from "../src/index.js";
import { assertValidDecision } from "../src/models.js";

function session(overrides = {}) {
  return {
    id: "session_2026-07-30_run",
    focus: "Tempo Run",
    type: "run",
    durationMinutes: 45,
    intensity: "high",
    targetMuscleGroups: ["legs"],
    exercises: ["Tempo Run"],
    ...overrides
  };
}

function state(overrides = {}) {
  return {
    date: "2026-07-30",
    readinessScore: 75,
    recoveryScore: 80,
    fatigueScore: 25,
    acuteChronicWorkloadRatio: 0.9,
    muscleFatigue: { legs: 20 },
    avoid: [],
    availableTimeMinutes: 60,
    confidence: "medium",
    signalCoverage: {
      recovery: { usable: ["hrv", "sleep"], missing: ["stress"] },
      training: { usable: ["trainingLoad"], missing: [] }
    },
    ...overrides
  };
}

test("low readiness turns a hard session into a lower-intensity one (from -> to)", () => {
  const result = decideSession({ scheduledSession: session(), state: state({ readinessScore: 52 }) });

  assert.equal(result.decision.type, "adjust");
  assert.equal(result.decision.intent, "reduce_today_intensity");
  assert.equal(result.action.from.intensity, "high");
  assert.equal(result.action.to.intensity, "moderate");
  assert.deepEqual(result.action.changed, ["focus", "intensity"]);
  assert.ok(result.reason.some((line) => line.includes("52")), "reason cites the readiness value");
});

test("a session renamed by an intensity cut no longer claims the stimulus it lost", () => {
  // Regression, found running the real MCP server: only `intensity` changed, so
  // the action came back reading "VO2max Intervals, 60 min, low" — a name that
  // promises a stimulus the decision just removed, and not a session anyone can
  // execute as written.
  const result = decideSession({
    scheduledSession: session({ focus: "VO2max Intervals", durationMinutes: 60 }),
    state: state({ readinessScore: 51, muscleFatigue: { legs: 96 } })
  });

  assert.equal(result.action.from.focus, "VO2max Intervals", "the plan as written is preserved");
  assert.equal(result.action.to.intensity, "low");
  assert.equal(result.action.to.focus, "Easy run", "the name follows the intensity");
  assert.ok(result.action.changed.includes("focus"));
});

test("an unchanged intensity leaves the session's name alone", () => {
  const result = decideSession({
    scheduledSession: session({ focus: "Tempo Run", intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: 30 })
  });

  assert.equal(result.action.to.focus, "Tempo Run", "a time cut is no reason to rename the session");
  assert.ok(!result.action.changed.includes("focus"));
});

test("every decision is grounded in evidence it actually names", () => {
  const result = decideSession({ scheduledSession: session(), state: state({ readinessScore: 52 }) });

  const signals = result.evidence.map((item) => item.signal);
  assert.ok(signals.includes("readiness"));
  assert.ok(signals.includes("muscle_fatigue.legs"));
  assert.ok(result.evidence.every((item) => item.value !== undefined));
});

test("very low readiness defers the session to recovery", () => {
  const result = decideSession({ scheduledSession: session(), state: state({ readinessScore: 35 }) });

  assert.equal(result.decision.type, "defer");
  assert.equal(result.action.to.type, "recovery");
  assert.equal(result.action.to.intensity, "low");
});

test("contraindicated movements are removed and outrank a routine intensity tweak", () => {
  const result = decideSession({
    scheduledSession: session({ exercises: ["Tempo Run", "Jumping Lunge"] }),
    state: state({ readinessScore: 52, avoid: ["avoid high-impact jumping"] })
  });

  // Safety is the headline decision, not the intensity change that also fired.
  assert.equal(result.decision.type, "substitute");
  assert.deepEqual(result.action.to.exercises, ["Tempo Run"]);
  assert.ok(result.action.changed.includes("exercises"));
  assert.ok(result.reason.some((line) => line.includes("Jumping Lunge")));
});

test("a fatigued target muscle blocks a hard session even when readiness is fine", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 78, muscleFatigue: { legs: 70 } })
  });

  assert.equal(result.action.to.intensity, "moderate");
  assert.ok(result.reason.some((line) => line.includes("70")));
});

test("an acute load spike pulls intensity down", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 75, acuteChronicWorkloadRatio: 1.6 })
  });

  assert.equal(result.decision.intent, "reduce_today_intensity");
  assert.ok(result.reason.some((line) => line.includes("1.6")));
});

test("a fresh athlete on an easy day is allowed to advance", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate" }),
    state: state({ readinessScore: 92, muscleFatigue: { legs: 15 } })
  });

  assert.equal(result.decision.type, "advance");
  assert.equal(result.action.to.intensity, "high");
});

test("keeping the session is itself a decision, with evidence", () => {
  const result = decideSession({ scheduledSession: session({ intensity: "moderate" }), state: state() });

  assert.equal(result.decision.type, "keep");
  assert.deepEqual(result.action.changed, []);
  assert.ok(result.reason.length > 0, "a keep still explains itself");
  assert.ok(result.evidence.length > 0);
});

test("time budget shortens the session", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: 30 })
  });

  assert.equal(result.action.to.durationMinutes, 30);
  assert.ok(result.action.changed.includes("durationMinutes"));
});

test("a time cut cites the budget as evidence, not just in prose", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: 30 })
  });

  const budget = result.evidence.find((item) => item.signal === "available_minutes");
  assert.ok(budget, "the number the reason quotes must appear in evidence");
  assert.equal(budget.value, 30);
  assert.equal(budget.source, "user_constraint");
});

test("a caller-supplied budget is marked as the override it is", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: 90 }),
    availableMinutes: 25
  });

  const budget = result.evidence.find((item) => item.signal === "available_minutes");
  assert.equal(budget.value, 25);
  assert.equal(budget.source, "session_override");
  assert.equal(result.action.to.durationMinutes, 25);
});

test("an unknown time budget never becomes a reason to shorten the session", () => {
  // Regression: with no availableMinutes supplied, an upstream default of 30
  // reached the engine as if it were a real constraint. A 60-minute session was
  // cut to 30 and the athlete was told "only 30 minutes are available" — a reason bound to
  // evidence they had never given. Unknown is unknown.
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: null })
  });

  assert.equal(result.action.to.durationMinutes, 60, "duration survives an unstated budget");
  assert.ok(!result.action.changed.includes("durationMinutes"));
  assert.ok(
    !result.reason.some((line) => /minutes are available/.test(line)),
    "nothing may be asserted about time we were never told"
  );
  assert.ok(!result.evidence.some((item) => item.signal === "available_minutes"));
  assert.ok(
    result.limits.some((line) => /available-time/.test(line)),
    "what we did not know is surfaced, not hidden"
  );
});

test("every quoted number in a reason traces back to an evidence entry", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ readinessScore: 52, muscleFatigue: { legs: 70 }, availableTimeMinutes: 45 })
  });

  const grounded = new Set(result.evidence.map((item) => String(item.value)));
  for (const line of result.reason) {
    for (const number of line.match(/\d+(\.\d+)?/g) || []) {
      assert.ok(
        grounded.has(number) || Object.values(RULES).map(String).includes(number),
        `reason quotes ${number}, which is neither evidence nor a stated rule threshold: ${line}`
      );
    }
  }
});

test("without a scheduled session there is no decision to make", () => {
  const result = decideSession({ scheduledSession: null, state: state() });

  assert.equal(result.decision.intent, "no_scheduled_session");
  assert.equal(result.action.from, null);
  assert.ok(result.limits.some((line) => /recommendation/.test(line)));
});

test("missing signals are surfaced as limits, not hidden", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({
      signalCoverage: {
        recovery: { usable: ["hrv"], missing: ["sleep", "stress"] },
        training: { usable: ["rpe", "trainingLoad"], missing: [] }
      }
    })
  });

  assert.ok(result.limits.some((line) => line.includes("sleep")));
  assert.equal(result.confidence, "medium");
});

test("an incomplete training week is surfaced as its own limit", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({
      signalCoverage: {
        recovery: { usable: ["hrv", "sleep"], missing: [] },
        training: { usable: [], missing: ["trainingLoad"] }
      }
    })
  });

  const line = result.limits.find((l) => l.includes("training load"));
  assert.ok(line, "a gap in the training half must reach the caller too");
  assert.match(line, /muscle fatigue is read from an incomplete week/);
  // The recovery half was clean, so it must not manufacture a recovery limit.
  assert.ok(!result.limits.some((l) => /confidence is lowered/.test(l)));
});

test("a state saved before coverage was split is read as recovery, not as complete", () => {
  // Phase 1 is stateless: the caller holds the state and sends it back. One
  // saved under the old flat shape must not read as "training was fine".
  const result = decideSession({
    scheduledSession: session(),
    state: state({ signalCoverage: { usable: ["hrv"], missing: ["sleep"] } })
  });

  assert.deepEqual(result.signalCoverage.recovery, { usable: ["hrv"], missing: ["sleep"] });
  assert.deepEqual(result.signalCoverage.training, { usable: [], missing: [] });
  assert.ok(result.limits.some((l) => l.includes("sleep")));
});

test("a state with no coverage at all claims nothing in either group", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ signalCoverage: undefined })
  });

  assert.deepEqual(result.signalCoverage, {
    recovery: { usable: [], missing: [] },
    training: { usable: [], missing: [] }
  });
});

test("a decision that changes nothing cannot claim to be an adjustment", () => {
  assert.throws(
    () =>
      assertValidDecision({
        evidence: [{ signal: "readiness", value: 50 }],
        state: {},
        decision: { type: "adjust", intent: "x" },
        action: { from: {}, to: {}, changed: [] },
        reason: ["r"]
      }),
    /changed nothing/
  );
});

test("a decision without a reason is rejected", () => {
  assert.throws(
    () =>
      assertValidDecision({
        evidence: [],
        state: {},
        decision: { type: "keep", intent: "x" },
        action: { from: null, to: null, changed: [] },
        reason: []
      }),
    /explain itself/
  );
});

test("an active restriction blocks advancing, however good readiness looks", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate" }),
    state: state({
      readinessScore: 92,
      muscleFatigue: { legs: 15 },
      avoid: ["avoid heavy lower body when fatigued"]
    })
  });

  assert.notEqual(result.decision.type, "advance", "never push intensity while a restriction is active");
  assert.equal(result.action.to.intensity, "moderate");
  assert.ok(result.reason.some((line) => /intensity is not raised/.test(line)));
});

test("a maxed-out muscle group is acted on even when readiness already cut a step", () => {
  // Regression, found driving the real MCP tool: rules ran in sequence, so the
  // readiness cut to "moderate" made the fatigue rule's `intensity === "high"`
  // test false. Legs at 100/100 the day after a 95-minute RPE-9 run went
  // unmentioned in the reasoning and cost nothing in intensity.
  const result = decideSession({
    scheduledSession: session(), // high intensity, targets legs
    state: state({ readinessScore: 49, muscleFatigue: { legs: 100 } })
  });

  assert.equal(result.action.to.intensity, "low", "two independent demands must both land");
  assert.ok(
    result.reason.some((line) => line.includes("100")),
    "the athlete must be told their legs are the reason"
  );
});

test("rule order does not change the outcome", () => {
  const both = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 49, muscleFatigue: { legs: 70 }, acuteChronicWorkloadRatio: 1.8 })
  });

  // Readiness, fatigue, and load each demand one step — the largest wins rather
  // than three cuts stacking a hard session down to nothing.
  assert.equal(both.action.to.intensity, "moderate");
  assert.ok(both.reason.length >= 3, "every rule that fired explains itself");
});

test("deferring to recovery replaces the movements, not just the label", () => {
  // Regression: the swap rewrote focus, type, duration, and intensity but left
  // the planned exercises in place, so the record read "Recovery + mobility"
  // while still prescribing VO₂max intervals.
  const result = decideSession({
    scheduledSession: session({ exercises: ["VO₂max Intervals"] }),
    state: state({ readinessScore: 34, muscleFatigue: { legs: 100 } })
  });

  assert.equal(result.decision.type, "defer");
  assert.ok(
    !result.action.to.exercises.some((name) => /VO₂|interval|tempo/i.test(name)),
    `hard work survived the swap: ${result.action.to.exercises.join(", ")}`
  );
  assert.ok(result.action.changed.includes("exercises"));
});

test("the recovery swap stays valid under an active restriction", () => {
  // The contraindication filter runs before the readiness rule, so movements
  // introduced by the swap are never filtered. They are chosen to be
  // equipment-free and low-impact for that reason; this pins the property.
  const restrictions = [
    "avoid high-impact jumping",
    "avoid heavy lower body when fatigued",
    "avoid burpees"
  ];
  const result = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 30, avoid: restrictions }),
    // Restrictions are written in spoken terms, so the property is about the
    // spoken form. The catalog spelling is pinned to the graph by
    // "every canonical id the engine can emit exists in the catalog".
    displayNameFor: (id) =>
      ({
        exercise_recovery_walk: "Recovery Walk",
        exercise_lower_body_mobility: "Mobility Flow"
      })[id] || id
  });

  for (const movement of result.action.to.exercises) {
    for (const restriction of restrictions) {
      const words = restriction.toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
      const hit = words.some((word) => word.length > 3 && movement.toLowerCase().includes(word));
      assert.ok(!hit, `recovery movement "${movement}" collides with "${restriction}"`);
    }
  }
});

/** What computeTrainingLoad hands over for someone `days` past their last session. */
function afterBreak(days, ctlLossPct = 78) {
  return { detraining: { active: true, daysSinceLastSession: days, ctlLossPct, ctlPeak: 31, lastSessionDate: "2026-05-27" } };
}

test("a rested but detrained athlete is eased back, not sent into the planned hard session", () => {
  // The gap this closes: recovery signals measure recovery, so two months off
  // reads *excellent* — high readiness, no muscle fatigue, and ACWR at 0, which
  // is the safest possible value to the ramp-rate rule. Every guard passed and
  // the athlete got their original tempo run back unchanged.
  const result = decideSession({
    scheduledSession: session(),
    state: state({
      readinessScore: 82,
      recoveryScore: 88,
      fatigueScore: 12,
      muscleFatigue: { legs: 5 },
      acuteChronicWorkloadRatio: 0,
      availableTimeMinutes: undefined,
      trainingLoad: afterBreak(62)
    })
  });

  assert.equal(result.decision.type, "adjust");
  assert.equal(result.decision.intent, "ease_back_after_break");
  assert.equal(result.action.to.intensity, "low", "62 days off is a reset, so two notches off high");
  assert.ok(result.action.to.durationMinutes < 45, "volume must come down with intensity");
  assert.ok(result.action.changed.includes("intensity"));
  assert.ok(result.action.changed.includes("durationMinutes"));
  assert.ok(
    result.reason.some((line) => /62 days/.test(line)),
    "the decision has to name the break it is reacting to"
  );
  assert.ok(
    result.evidence.some((item) => item.signal === "days_since_last_session" && item.value === 62),
    "the reason must trace back to cited evidence"
  );
  assertValidDecision(result);
});

test("a shorter break costs one notch, not two", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 82, muscleFatigue: { legs: 5 }, acuteChronicWorkloadRatio: 0, trainingLoad: afterBreak(20, 40) })
  });

  assert.equal(result.decision.intent, "ease_back_after_break");
  assert.equal(result.action.to.intensity, "moderate");
});

const INTENSITY_NOT_RAISED = (result) =>
  ["low", "moderate", "high"].indexOf(result.action.to.intensity) <=
  ["low", "moderate", "high"].indexOf(result.action.from.intensity);

test("excellent readiness does not advance a detrained athlete", () => {
  // Being fresh is not the same as being ready to progress, and a returning
  // athlete scores exactly the high-readiness / low-fatigue profile the
  // progression rule looks for.
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate" }),
    state: state({ readinessScore: 92, muscleFatigue: { legs: 5 }, acuteChronicWorkloadRatio: 0, trainingLoad: afterBreak(70) })
  });

  assert.notEqual(result.decision.type, "advance");
  assert.ok(
    INTENSITY_NOT_RAISED(result),
    `intensity went up for a detrained athlete: ${result.action.to.intensity}`
  );
});

test("training load with no break leaves the existing rules untouched", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ trainingLoad: { detraining: { active: false, daysSinceLastSession: 1, ctlLossPct: 2 } } })
  });

  assert.equal(result.decision.type, "keep");
});

test("every canonical id the engine can emit exists in the catalog", async () => {
  // decideSession names movements without holding the catalog, so nothing at
  // runtime would notice a typo in a recovery id — the swapped-in session would
  // just prescribe something nothing can describe, which is how "Easy walk"
  // survived. This is the join the engine cannot make for itself.
  const { readFile } = await import("node:fs/promises");
  const graph = JSON.parse(
    await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
  );
  const ids = new Set(graph.exercises.map((exercise) => exercise.id));

  const deferred = decideSession({
    scheduledSession: session(),
    state: state({ readinessScore: 25 })
  });
  const blockedOut = decideSession({
    scheduledSession: { ...session(), exerciseIds: ["exercise_back_squat"] },
    state: state({ avoid: ["avoid squat"] })
  });

  for (const id of [...deferred.action.to.exerciseIds, ...blockedOut.action.to.exerciseIds]) {
    assert.ok(ids.has(id), `${id} is not in the catalog`);
  }
});

test("the decision speaks colloquially but changes are judged on ids", () => {
  const result = decideSession({
    scheduledSession: { ...session(), exerciseIds: ["exercise_zone2_run"] },
    state: state({ readinessScore: 25 }),
    displayNameFor: (id) => ({ exercise_zone2_run: "Zone 2 Run", exercise_recovery_walk: "Recovery Walk", exercise_lower_body_mobility: "Mobility Flow" })[id] || id
  });

  assert.deepEqual(result.action.from.exerciseIds, ["exercise_zone2_run"]);
  assert.deepEqual(result.action.from.exercises, ["Zone 2 Run"]);
  assert.deepEqual(result.action.to.exerciseIds, ["exercise_recovery_walk", "exercise_lower_body_mobility"]);
  assert.deepEqual(result.action.to.exercises, ["Recovery Walk", "Mobility Flow"]);
  assert.ok(result.action.changed.includes("exercises"));
});

// --- the athlete proposes an alternative -----------------------------------
//
// "Today was cardio — can I do mobility work instead?" is a question the engine
// used to leave unanswered: it applied its own rules and handed back its own
// `to`, saying nothing about the option the person had actually named.

test("a proposal inside today's ceiling is accepted and becomes the action", () => {
  const result = decideSession({
    scheduledSession: session(),
    proposedSession: {
      focus: "Recovery + mobility",
      type: "mobility",
      durationMinutes: 30,
      intensity: "low",
      targetMuscleGroups: ["hips", "core"],
      exercises: ["exercise_lower_body_mobility"]
    },
    state: state({ readinessScore: 52 })
  });

  assert.equal(result.proposal.verdict, "accepted");
  assert.deepEqual(result.proposal.violations, []);
  assert.equal(result.decision.type, "substitute");
  assert.equal(result.decision.intent, "accept_athlete_proposal");
  assert.equal(result.action.to.focus, "Recovery + mobility");
  assert.equal(result.action.to.intensity, "low");
  assertValidDecision(result);
});

test("a proposal above the ceiling is refused, and the refusal names the axis", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 45 }),
    proposedSession: {
      focus: "VO2max Intervals",
      type: "run",
      durationMinutes: 60,
      intensity: "high",
      targetMuscleGroups: ["legs"],
      exercises: ["Tempo Run"]
    },
    // Readiness below the reduce threshold caps today at one notch down.
    state: state({ readinessScore: 52 })
  });

  assert.equal(result.proposal.verdict, "rejected");
  assert.ok(result.proposal.violations.some((v) => /intensity/.test(v)), "names the intensity axis");
  assert.ok(result.proposal.violations.some((v) => /duration/.test(v)), "names the duration axis");
  // Refusing the proposal must not leave the athlete without an answer.
  assert.equal(result.action.to.intensity, "low");
  assertValidDecision(result);
});

test("resting more than required is always allowed", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "high", durationMinutes: 60 }),
    proposedSession: {
      focus: "Easy walk",
      type: "recovery",
      durationMinutes: 20,
      intensity: "low",
      targetMuscleGroups: [],
      exercises: ["exercise_recovery_walk"]
    },
    // Nothing wrong today — the ceiling is the session as planned.
    state: state({ readinessScore: 80 })
  });

  assert.equal(result.proposal.verdict, "accepted");
});

test("a proposal cannot switch off an injury restriction", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: "low" }),
    proposedSession: {
      focus: "Squats",
      type: "strength",
      durationMinutes: 30,
      intensity: "low",
      targetMuscleGroups: ["legs"],
      exercises: ["Barbell Back Squat"]
    },
    state: state({ readinessScore: 80, avoid: ["avoid barbell loading"] })
  });

  assert.equal(result.proposal.verdict, "rejected");
  assert.ok(result.proposal.violations.some((v) => /restricted movements/.test(v)));
});

test("a proposal aimed at an already-fatigued muscle group is caught", () => {
  // The fatigue rules judge the *scheduled* session's target muscles. A proposal
  // pointing somewhere else has to be re-checked or it slips past all of them.
  const result = decideSession({
    scheduledSession: session({ targetMuscleGroups: ["chest"], intensity: "moderate" }),
    proposedSession: {
      focus: "Leg day",
      type: "strength",
      durationMinutes: 45,
      intensity: "moderate",
      targetMuscleGroups: ["legs"],
      exercises: ["Barbell Back Squat"]
    },
    state: state({ readinessScore: 80, muscleFatigue: { chest: 10, legs: 88 } })
  });

  assert.equal(result.proposal.verdict, "rejected");
  assert.ok(result.proposal.violations.some((v) => v.includes("legs")));
});

test("no proposal, no proposal field — the shape does not change for callers who did not ask", () => {
  const result = decideSession({ scheduledSession: session(), state: state() });
  assert.equal("proposal" in result, false);
});

// --- an incomplete scheduledSession ----------------------------------------
//
// `type` and `intensity` are both optional on evidra_decide_session's input contract,
// and no connector can supply either: they describe a session that has not
// happened, so they exist only in the caller's plan. Both omissions used to
// produce output that read as though the value had been known.

test("a session with no type is not relabelled to the literal string undefined", () => {
  const result = decideSession({
    scheduledSession: session({ type: undefined, focus: "VO₂max Intervals" }),
    state: state({ readinessScore: 55 })
  });

  assert.equal(result.action.to.focus, "Moderate session");
  assert.doesNotMatch(JSON.stringify(result), /undefined/);
});

test("a session with no type keeps the intensity in its name — only the modality is dropped", () => {
  const result = decideSession({
    scheduledSession: session({ type: undefined, intensity: "moderate" }),
    state: state({ readinessScore: 55 })
  });

  assert.equal(result.action.to.intensity, "low");
  assert.equal(result.action.to.focus, "Easy session");
});

test("an unstated intensity is not read as low", () => {
  // lowerIntensity(undefined) lands on the bottom of the scale, so this used to
  // tell the athlete their intensity had come down to low from a value nobody
  // supplied — plausible enough that nothing would have caught it.
  const result = decideSession({
    scheduledSession: session({ intensity: undefined }),
    state: state({ readinessScore: 55 })
  });

  assert.equal(result.action.to.intensity, undefined);
  assert.ok(
    result.reason.every((line) => !/intensity comes down/.test(line)),
    "the decision claimed an intensity change it could not make"
  );
});

test("an unstated intensity is reported as a limit, naming the field that would fix it", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: undefined }),
    state: state({ readinessScore: 55 })
  });

  const limit = result.limits.find((line) => /states no intensity/.test(line));
  assert.ok(limit, "nothing told the caller why the intensity was left alone");
  assert.match(limit, /scheduledSession\.intensity/);
});

test("a withheld intensity cut is not reported as an all-clear", () => {
  // The decision lands on `keep` because nothing changed, and the stock `keep`
  // reason says the readings were within range. Here they were not.
  const result = decideSession({
    scheduledSession: session({ intensity: undefined }),
    state: state({ readinessScore: 55 })
  });

  assert.equal(result.decision.type, "keep");
  assert.ok(
    result.reason.every((line) => !/within range/.test(line)),
    "a session held back by a missing field was reported as evidence-clear"
  );
  assert.ok(result.reason.some((line) => /could not be applied/.test(line)));
});

test("an unstated intensity does not suppress a genuine all-clear", () => {
  const result = decideSession({
    scheduledSession: session({ intensity: undefined }),
    state: state({ readinessScore: 85, muscleFatigue: { legs: 10 } })
  });

  assert.equal(result.decision.type, "keep");
  assert.ok(result.reason.some((line) => /within range/.test(line)));
  assert.equal(
    result.limits.some((line) => /states no intensity/.test(line)),
    false,
    "a limit was reported for a rule that never fired"
  );
});
