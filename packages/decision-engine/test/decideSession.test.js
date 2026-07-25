import test from "node:test";
import assert from "node:assert/strict";

import { decideSession } from "../src/index.js";
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
