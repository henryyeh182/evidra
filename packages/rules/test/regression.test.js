// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Rule regression set.
 *
 * One case per rule in the library, each pinning the rule that must govern the
 * decision and the change that rule must produce. Run before any rule edit:
 * `npm run test:rules`.
 *
 * What this catches that the golden set does not. The golden set fixes whole
 * outputs for a handful of realistic sessions, so a threshold can be edited
 * without any case noticing — no golden case sits close enough to 1.4 or 65 for
 * a small move to change its answer. These cases are built to sit on the
 * threshold: each supplies evidence just past its rule's cut point, so widening
 * that cut point silently is impossible. Loosening `acwrHigh` from 1.4 to 1.6
 * fails the ACWR case immediately.
 *
 * That is the point of a rule regression as opposed to an output regression: it
 * protects the *reason*, not just the answer. A decision can come out right for
 * the wrong rule, and this is the only thing that would say so.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { decideSession } from "../../decision-engine/src/index.js";
import { getRuleLibrary } from "../src/index.js";

const DATE = "2026-08-06";

/** A state with every dial at a value that fires nothing. Cases move one dial. */
function restedState(overrides = {}) {
  return {
    date: DATE,
    readinessScore: 75,
    recoveryScore: 75,
    muscleFatigue: { legs: 10, chest: 10, back: 10 },
    acuteChronicWorkloadRatio: 1.0,
    acwrCoverage: {
      chronicWindowDays: 28,
      historyDays: 28,
      sessionsInWindow: 12,
      sufficientHistory: true,
      chronicBasis: "observed"
    },
    confidence: "high",
    signalCoverage: {
      recovery: { usable: ["sleep", "hrv", "restingHeartRate", "stress"], missing: [] },
      training: { usable: ["trainingLoad"], missing: [] }
    },
    ...overrides
  };
}

const HARD_RUN = { focus: "VO2max Intervals", type: "run", durationMinutes: 60, intensity: "high" };

// The fatigue rules read `targetMuscleGroups`, not the exercise names — a
// session that never says which muscles it loads cannot trigger them, and the
// engine is right not to guess. Stated explicitly here so the case tests the
// threshold rather than the absence of a field.
const LEG_STRENGTH = {
  focus: "Back Squat",
  type: "strength",
  durationMinutes: 60,
  intensity: "high",
  targetMuscleGroups: ["legs"],
  exercises: ["Back Squat"]
};

function decide(state, scheduledSession = HARD_RUN, extra = {}) {
  return decideSession({ state, scheduledSession, ...extra });
}

/**
 * Each case names the rule it exists to protect, the evidence that should fire
 * it, and what must come out. `governing` is asserted, not merely `fired`: the
 * arbitration policy is part of what a rule edit can break.
 */
const CASES = [
  {
    ruleId: "EVD-R-001",
    what: "readiness below the rest threshold replaces the session",
    state: restedState({ readinessScore: 39 }),
    expect: { governing: "EVD-R-001", decision: "defer", intensity: "low", maxDuration: 30 }
  },
  {
    ruleId: "EVD-R-002",
    what: "readiness below the reduce threshold takes one step off",
    state: restedState({ readinessScore: 59 }),
    expect: { governing: "EVD-R-002", decision: "adjust", intensity: "moderate" }
  },
  {
    ruleId: "EVD-R-003",
    what: "a maxed-out target muscle group takes two steps off",
    state: restedState({ muscleFatigue: { legs: 90 } }),
    session: LEG_STRENGTH,
    expect: { governing: "EVD-R-003", decision: "adjust", intensity: "low" }
  },
  {
    ruleId: "EVD-R-004",
    what: "high fatigue in the target group takes one step off",
    state: restedState({ muscleFatigue: { legs: 65 } }),
    session: LEG_STRENGTH,
    expect: { governing: "EVD-R-004", decision: "adjust", intensity: "moderate" }
  },
  {
    ruleId: "EVD-R-006",
    what: "an acute load spike takes one step off",
    state: restedState({ acuteChronicWorkloadRatio: 1.41 }),
    expect: { governing: "EVD-R-006", decision: "adjust", intensity: "moderate" }
  },
  {
    ruleId: "EVD-R-008",
    what: "high readiness on a fresh group allows a step up",
    state: restedState({ readinessScore: 85, muscleFatigue: { legs: 5 } }),
    session: { ...HARD_RUN, intensity: "low" },
    expect: { governing: "EVD-R-008", decision: "advance", intensity: "moderate" }
  },
  {
    ruleId: "EVD-R-009",
    what: "a restriction naming a scheduled movement removes it",
    // Readiness low enough that EVD-R-002 fires too. That is the case worth
    // pinning: injury is rank 1, so the removal must be what the decision is
    // attributed to even though another rule fired and is what actually moves
    // the intensity.
    state: restedState({ readinessScore: 55, avoid: ["avoid heavy squat"] }),
    session: LEG_STRENGTH,
    expect: { governing: "EVD-R-009", decision: "substitute", intensity: "moderate" }
  }
];

for (const testCase of CASES) {
  test(`rule regression ${testCase.ruleId}: ${testCase.what}`, () => {
    const result = decide(testCase.state, testCase.session ?? HARD_RUN);
    const basis = result.decisionBasis;

    assert.equal(
      basis.governingRule?.ruleId,
      testCase.expect.governing,
      `expected ${testCase.expect.governing} to govern, got ${basis.governingRule?.ruleId ?? "none"} — ` +
        `the decision may still be right, but it is being attributed to the wrong rule`
    );
    assert.equal(result.decision.type, testCase.expect.decision);
    assert.equal(result.action.to.intensity, testCase.expect.intensity);

    if (testCase.expect.maxDuration !== undefined) {
      assert.ok(
        result.action.to.durationMinutes <= testCase.expect.maxDuration,
        `duration ${result.action.to.durationMinutes} exceeds the cap this rule imposes`
      );
    }
  });
}

// Just inside the threshold on every dial. If a rule edit widens a cut point,
// this is the case that starts firing when it should not — the failure mode a
// per-rule case cannot see, because each of those only proves its own rule
// still fires.
test("rule regression: evidence just inside every threshold changes nothing", () => {
  const result = decide(
    restedState({ readinessScore: 60, muscleFatigue: { legs: 44 }, acuteChronicWorkloadRatio: 1.4 })
  );

  assert.equal(result.decision.type, "keep");
  assert.equal(result.action.to.intensity, "high");
  assert.equal(
    result.decisionBasis.appliedRules.length,
    0,
    `no rule should fire here; fired: ${result.decisionBasis.appliedRules.map((r) => r.ruleId).join(", ")}`
  );
});

// A rule that fires but cannot act must still appear. Dropping it would let
// decisionBasis report silence on a day the evidence spoke.
test("rule regression: a blocked rule is still recorded", () => {
  // Readiness in EVD-R-002's band, not EVD-R-001's: the rest rule rewrites the
  // session outright and never needs a stated intensity, so only a rule that
  // asks for a step down can be blocked by the absence of one.
  const result = decide(restedState({ readinessScore: 55 }), {
    focus: "Something",
    type: "run",
    durationMinutes: 60
    // no intensity: the reduction cannot be applied
  });

  const blocked = result.decisionBasis.appliedRules.filter((rule) => rule.applied === false);
  assert.ok(blocked.length > 0, "a rule that triggered and could not act must be reported, not dropped");
});

// The set has to keep pace with the library, or a rule added tomorrow ships
// with nothing pinning it.
test("every active rule in the library has a regression case", () => {
  const covered = new Set(CASES.map((testCase) => testCase.ruleId));
  // Session rules only. Every case here hands `decideSession` a hand-written
  // state, so a rule the plan generator or the catalog applies has no case that
  // could be written in this file — it is pinned in the suite of the package
  // that applies it. `appliedBy` is what makes that split checkable rather than
  // a matter of remembering which rules belong where.
  const uncovered = getRuleLibrary()
    .rules.filter((rule) => rule.status === "active" && rule.appliedBy === "session")
    .map((rule) => rule.ruleId)
    .filter((ruleId) => !covered.has(ruleId));

  assert.deepEqual(
    uncovered,
    ["EVD-R-005", "EVD-R-007"],
    `every active rule needs a case here. Uncovered: ${uncovered.join(", ")}. ` +
      `EVD-R-005 (advisory, changes nothing) and EVD-R-007 (detraining, needs a training-load ` +
      `history rather than a state fixture) are the two known exceptions — they are covered by ` +
      `the decision-engine suite. Adding a rule means adding a case, or amending this list ` +
      `deliberately.`
  );
});
