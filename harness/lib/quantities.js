// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Where each rule's threshold reads its number from, and how to move that
 * number.
 *
 * DH-COV asks whether a rule can be reached at all. This file is what lets
 * DH-BND ask the sharper question: is the rule reached *at its edge*, and does
 * it stay quiet one step short of it. Answering that needs the measured
 * quantity in hand for scenarios where the rule did **not** fire — and a rule
 * that did not fire records nothing in `decisionBasis`, so there is nowhere
 * else to read it from.
 *
 * The duplication that implies is real and is guarded rather than denied.
 * Whenever a rule does fire, DH-BND compares the reader here against the
 * reading the engine recorded and fails if they disagree, so a reader that
 * drifts away from what the engine actually measures goes red on the next run
 * rather than quietly checking the wrong number.
 *
 * `gates` is the field that stops this from being a table of thresholds that
 * all mean the same thing. They do not:
 *
 *   firing    Crossing this decides whether the rule fires at all.
 *   severity  The rule fires either side of it; crossing it changes how hard
 *             the rule pushes. EVD-R-007 is the whole reason this value
 *             exists — see its note below.
 *   effect    Not a comparison at all. A cap or a multiplier the rule applies
 *             *after* it has fired. There is no side to be on, so DH-BND
 *             refuses to accept a straddle declared against one.
 */

import { getRule, getRuleLibrary } from "../../packages/rules/src/index.js";

/**
 * The smallest step that is representable in each unit the library uses.
 *
 * This is what makes "just below" a claim rather than a label: a scenario
 * declaring `just_below` has to sit within one of these of the threshold, so
 * "just below 65" cannot quietly be 20.
 *
 * An unlisted unit is an error rather than a default. A guessed step size would
 * silently widen or narrow every straddle written against it.
 */
const STEP_BY_UNIT = {
  readiness_score: 1,
  fatigue_score: 1,
  days: 1,
  percent: 1,
  movements: 1,
  characters: 1,
  ratio: 0.01
};

export function stepFor(threshold) {
  const step = STEP_BY_UNIT[threshold.unit];
  if (step === undefined) {
    throw new Error(
      `no step size is declared for the unit "${threshold.unit}", so "just below ` +
        `${threshold.value}" has no defined meaning`
    );
  }
  return step;
}

/** The reading of `targetMuscleFatigue`, which is null when nothing is targeted. */
const targetFatigue = (run) => run.decision.state.targetMuscleFatigue?.value ?? 0;

const nudgeTargetFatigue = (state, value, run) => {
  const group = run.decision.state.targetMuscleFatigue?.group;
  if (!group) return state;
  return { ...state, muscleFatigue: { ...state.muscleFatigue, [group]: value } };
};

const detrainingReader = (field) => (run) => run.engineState.trainingLoad?.detraining?.[field] ?? null;

const nudgeDetraining = (field) => (state, value) => ({
  ...state,
  trainingLoad: {
    ...state.trainingLoad,
    detraining: { ...state.trainingLoad?.detraining, [field]: value }
  }
});

/**
 * One entry per threshold in the library, keyed `ruleId/thresholdKey`.
 *
 * `read` takes a completed run and returns the number the threshold is compared
 * against, or null when the scenario supplies nothing to compare.
 *
 * `nudge` returns a copy of the engine state with that number moved, and is
 * what lets DH-BND prove a silence. It is null where the quantity is not a
 * field of the state — EVD-R-009 counts movements that match a restriction,
 * which is computed inside the engine from two things the state does not hold —
 * and a threshold with no `nudge` has to name a sibling scenario instead.
 *
 * `engineField` names the field of the rule's recorded `measured` that holds
 * this same number, and it is what lets DH-BND check the reader above against
 * the engine's own reading. It is absent rather than guessed where a rule has
 * more thresholds than it publishes readings: a rule records one reading, and
 * on EVD-R-009 that reading is the movement count, so nothing in the record
 * corresponds to the token length its second threshold cuts. Absent means the
 * cross-check is skipped and the reader is on its own — worth knowing, and
 * worth not papering over by comparing against whichever number happens to be
 * there.
 */
export const QUANTITIES = {
  "EVD-R-001/readinessRest": {
    gates: "firing",
    engineField: "value",
    read: (run) => run.engineState.readinessScore ?? null,
    nudge: (state, value) => ({ ...state, readinessScore: value })
  },
  // The cap this rule puts on a recovery session's length. Applied after the
  // rule fires; nothing is ever compared against it.
  "EVD-R-001/recoveryCapMinutes": { gates: "effect" },

  "EVD-R-002/readinessReduce": {
    gates: "firing",
    engineField: "value",
    read: (run) => run.engineState.readinessScore ?? null,
    nudge: (state, value) => ({ ...state, readinessScore: value })
  },

  "EVD-R-003/muscleFatigueMaxed": {
    gates: "firing",
    engineField: "value",
    read: targetFatigue,
    nudge: nudgeTargetFatigue
  },
  "EVD-R-004/muscleFatigueHigh": {
    gates: "firing",
    engineField: "value",
    read: targetFatigue,
    nudge: nudgeTargetFatigue
  },
  "EVD-R-005/muscleFatigueModerate": {
    gates: "firing",
    engineField: "value",
    read: targetFatigue,
    nudge: nudgeTargetFatigue
  },

  "EVD-R-006/acwrHigh": {
    gates: "firing",
    engineField: "value",
    read: (run) =>
      typeof run.engineState.acuteChronicWorkloadRatio === "number"
        ? run.engineState.acuteChronicWorkloadRatio
        : null,
    nudge: (state, value) => ({ ...state, acuteChronicWorkloadRatio: value })
  },

  // Both of EVD-R-007's thresholds are `severity`, and the distinction is not a
  // technicality. What decides whether this rule fires at all is
  // `detraining.active`, and that is computed in
  // packages/training-load/src/trainingLoad.js from two bare constants — 14
  // idle days and a 25% chronic-load loss — which are not in the rule library.
  // They are therefore outside the fingerprint, carry no provenance, and are
  // not reported in `decisionBasis`. The library's 42 and 60 only choose
  // between one intensity step and two. DH-BND checks them for what they are;
  // that the firing gate lives somewhere unversioned is a finding about the
  // rule library, not something this file can fix by pretending otherwise.
  "EVD-R-007/returnSevereIdleDays": {
    gates: "severity",
    engineField: "daysSinceLastSession",
    read: detrainingReader("daysSinceLastSession"),
    nudge: nudgeDetraining("daysSinceLastSession"),
    // No scenario can put this threshold at its edge, because by the time it is
    // reached the other arm of the same `||` has already been true for four
    // days. Chronic load decays on a fixed curve once training stops — the
    // series multiplies by (1 - 1/42) a day with no load — so days idle and
    // percent lost are one quantity wearing two names. Measured against
    // `computeTrainingLoad` on 2026-08-06 over blocks of 3 and 12 sessions at
    // loads of 30, 60 and 90: 38 days idle gives exactly 60% lost, 41 gives 63%
    // and 42 gives 63-64%, and the block's size and weight moved none of it by
    // more than a point.
    //
    // So `severe` is already true at 38 days and 42 changes nothing. The
    // threshold could be 39 or 39,000 and no decision in this library would
    // differ. That is a finding about EVD-R-007 rather than a gap in the
    // scenario set, and it is recorded here rather than papered over with a
    // scenario that would pass while proving nothing: a case at 42 days does
    // fire severely, but not on this threshold's account.
    unreachable:
      "collinear with returnSevereCtlLossPct — chronic-load decay makes 60% lost arrive at 38 " +
      "idle days, so the 42-day arm of the same `||` can never be what flips severity"
  },
  "EVD-R-007/returnSevereCtlLossPct": {
    gates: "severity",
    engineField: "ctlLossPct",
    read: detrainingReader("ctlLossPct"),
    nudge: nudgeDetraining("ctlLossPct")
  },
  // The fraction of planned duration a first session back is cut to.
  "EVD-R-007/returnDurationFactor": { gates: "effect" },

  "EVD-R-008/readinessAdvance": {
    gates: "firing",
    engineField: "value",
    read: (run) => run.engineState.readinessScore ?? null,
    nudge: (state, value) => ({ ...state, readinessScore: value })
  },
  "EVD-R-008/muscleFatigueModerate": {
    gates: "firing",
    engineField: "targetMuscleFatigue",
    read: targetFatigue,
    nudge: nudgeTargetFatigue
  },

  "EVD-R-009/restrictedMovementsPresent": {
    gates: "firing",
    engineField: "value",
    // Not in the state: the engine derives it by matching each movement's
    // spoken name against the restrictions. A rule that fired recorded the
    // count; a rule that did not fire counted nothing, which is what its own
    // threshold (>= 1) means.
    read: (run) =>
      run.decision.decisionBasis?.appliedRules?.find((rule) => rule.ruleId === "EVD-R-009")?.measured
        ?.value ?? 0,
    nudge: null
  },
  "EVD-R-009/restrictionTokenMinLength": {
    gates: "firing",
    // The longest word any active restriction offers the matcher, which is what
    // decides whether the restriction can match anything at all. "avoid hip"
    // gives 3 and matches nothing however live the injury is.
    read: (run) => {
      const restrictions = (run.scenario.evidence.constraints?.injuries || [])
        .filter((injury) => (injury.status ?? "active") === "active")
        .flatMap((injury) => injury.restrictions || []);
      if (restrictions.length === 0) return null;
      const words = restrictions.flatMap((restriction) =>
        String(restriction)
          .toLowerCase()
          .replace(/^avoid\s+/, "")
          .split(/[\s-]+/)
      );
      return words.reduce((longest, word) => Math.max(longest, word.length), 0);
    },
    nudge: null
  }
};

/**
 * Every threshold in the library, with its entry here attached.
 *
 * Exported as one list so the "is anything unaccounted for" check and the
 * coverage requirement read the same set. A rule added to the library with no
 * entry here appears with `quantity: undefined` and DH-BND reports it, rather
 * than the threshold silently going unstraddled.
 */
export function libraryThresholds() {
  return getRuleLibrary()
    .rules.filter((rule) => rule.status === "active")
    .flatMap((rule) =>
      (rule.thresholds || []).map((threshold) => ({
        ruleId: rule.ruleId,
        key: threshold.key,
        threshold,
        quantity: QUANTITIES[`${rule.ruleId}/${threshold.key}`]
      }))
    );
}

/** Is this reading on the side of the threshold that the rule acts on? */
export function onActingSide(measured, threshold) {
  switch (threshold.operator) {
    case "<":
      return measured < threshold.value;
    case "<=":
      return measured <= threshold.value;
    case ">":
      return measured > threshold.value;
    case ">=":
      return measured >= threshold.value;
    default:
      throw new Error(`operator "${threshold.operator}" is not a comparison`);
  }
}

/** The nearest reading on the acting side — where the boundary probe pushes to. */
export function actingSideValue(threshold) {
  const step = stepFor(threshold);
  switch (threshold.operator) {
    case "<":
      return Number((threshold.value - step).toFixed(4));
    case "<=":
      return threshold.value;
    case ">":
      return Number((threshold.value + step).toFixed(4));
    case ">=":
      return threshold.value;
    default:
      throw new Error(`operator "${threshold.operator}" is not a comparison`);
  }
}

/**
 * Which positions a threshold needs covered.
 *
 * `triggers` and `boundary` always. `just_below` only where the operator admits
 * equality: on `>=` the reading *at* the threshold fires, so a separate
 * non-firing case one step off is needed to show where the rule stops. On `<`
 * and `>` the reading at the threshold does not fire, so the boundary case is
 * already the non-firing one and demanding a third would be asking for the same
 * scenario twice.
 *
 * A threshold marked `unreachable` is asked only for `triggers`. That is an
 * exemption, so it costs a written reason in `QUANTITIES` and DH-BND prints it
 * on every run — an edge nobody can reach is a fact about the rule, and the one
 * thing that must not happen to it is going quiet.
 */
export function requiredPositions(threshold, quantity) {
  if (quantity?.unreachable) return ["triggers"];
  const admitsEquality = threshold.operator === ">=" || threshold.operator === "<=";
  return admitsEquality ? ["triggers", "boundary", "just_below"] : ["triggers", "boundary"];
}

/** Does a reading at exactly the threshold value act? */
export function boundaryActs(threshold) {
  return onActingSide(threshold.value, threshold);
}

/** The threshold definition a scenario's declaration points at. */
export function findThreshold(ruleId, key) {
  return (getRule(ruleId)?.thresholds || []).find((threshold) => threshold.key === key) ?? null;
}
