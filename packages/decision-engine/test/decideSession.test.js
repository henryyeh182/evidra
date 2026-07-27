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
    signalCoverage: { usable: ["hrv", "sleep"], missing: ["stress"] },
    ...overrides
  };
}

test("low readiness turns a hard session into a lower-intensity one (from -> to)", () => {
  const result = decideSession({ scheduledSession: session(), state: state({ readinessScore: 52 }) });

  assert.equal(result.decision.type, "adjust");
  assert.equal(result.decision.intent, "reduce_today_intensity");
  assert.equal(result.action.from.intensity, "high");
  assert.equal(result.action.to.intensity, "moderate");
  assert.deepEqual(result.action.changed, ["intensity"]);
  assert.ok(result.reason.some((line) => line.includes("52")), "reason cites the readiness value");
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
  // cut to 30 and the athlete was told "可用時間僅 30 分鐘" — a reason bound to
  // evidence they had never given. Unknown is unknown.
  const result = decideSession({
    scheduledSession: session({ intensity: "moderate", durationMinutes: 60 }),
    state: state({ availableTimeMinutes: null })
  });

  assert.equal(result.action.to.durationMinutes, 60, "duration survives an unstated budget");
  assert.ok(!result.action.changed.includes("durationMinutes"));
  assert.ok(
    !result.reason.some((line) => line.includes("可用時間")),
    "nothing may be asserted about time we were never told"
  );
  assert.ok(!result.evidence.some((item) => item.signal === "available_minutes"));
  assert.ok(
    result.limits.some((line) => line.includes("可用時間")),
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
  assert.ok(result.limits.some((line) => line.includes("推薦")));
});

test("missing signals are surfaced as limits, not hidden", () => {
  const result = decideSession({
    scheduledSession: session(),
    state: state({ signalCoverage: { usable: ["hrv"], missing: ["sleep", "stress"] } })
  });

  assert.ok(result.limits.some((line) => line.includes("sleep")));
  assert.equal(result.confidence, "medium");
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
  assert.ok(result.reason.some((line) => line.includes("不提升強度")));
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
    state: state({ readinessScore: 30, avoid: restrictions })
  });

  for (const movement of result.action.to.exercises) {
    for (const restriction of restrictions) {
      const words = restriction.toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
      const hit = words.some((word) => word.length > 3 && movement.toLowerCase().includes(word));
      assert.ok(!hit, `recovery movement "${movement}" collides with "${restriction}"`);
    }
  }
});
