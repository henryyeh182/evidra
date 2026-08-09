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

import { getRule, getRuleLibrary, THRESHOLDS } from "../../packages/rules/src/index.js";

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
 * The same nudge for the two arms that decide whether EVD-R-007 fires at all.
 *
 * `detraining.active` is the conjunction of both, computed in trainingLoad.js
 * before `decideSession` ever sees the state — so moving one arm without
 * recomputing it moves a number the rule does not read, and the straddle proves
 * nothing. DH-BND caught exactly that: a scenario one day under the gate stayed
 * quiet when nudged over it, because `active` was still false underneath.
 *
 * Reproducing the engine's conjunction here is duplication, and it is the same
 * guarded duplication as the readers above: whenever the rule does fire, DH-BND
 * compares this file's reading against what the engine recorded.
 */
const nudgeDetrainingGate = (field) => (state, value) => {
  const detraining = { ...state.trainingLoad?.detraining, [field]: value };
  detraining.active =
    detraining.daysSinceLastSession != null &&
    detraining.daysSinceLastSession >= THRESHOLDS.detrainingMinIdleDays &&
    detraining.ctlLossPct >= THRESHOLDS.detrainingMinCtlLossPct;
  return { ...state, trainingLoad: { ...state.trainingLoad, detraining } };
};

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

  // EVD-R-007 is the rule that made `gates` necessary, and as of 2026-08-09 it
  // declares both kinds. `detrainingMinIdleDays` and `detrainingMinCtlLossPct`
  // are `firing`: they are evaluated in
  // packages/training-load/src/trainingLoad.js as `detraining.active`, and until
  // that date they lived outside the library as EVD-P-001 and EVD-P-002 — the
  // gate deciding whether the rule fires sat a governance tier below the rule,
  // outside `decisionBasis`, while the 42 and 60 that only choose between one
  // intensity step and two were the numbers a caller was shown. Both pairs are
  // now the rule's own, and both are straddled here.
  //
  // Both `firing` arms move together and cannot be straddled independently: they
  // are read off the same decayed curve, so nudging the state to sit one day
  // under 14 also moves the percentage. The scenarios straddle them as the pair
  // they are.
  "EVD-R-007/detrainingMinIdleDays": {
    gates: "firing",
    engineField: "daysSinceLastSession",
    read: detrainingReader("daysSinceLastSession"),
    nudge: nudgeDetrainingGate("daysSinceLastSession")
  },
  "EVD-R-007/detrainingMinCtlLossPct": {
    gates: "firing",
    engineField: "ctlLossPct",
    read: detrainingReader("ctlLossPct"),
    nudge: nudgeDetrainingGate("ctlLossPct"),
    // Unreachable, and for the same structural reason as returnSevereIdleDays
    // one tier up: both arms are read off one decayed curve. 25% of chronic load
    // is gone by idle day 12, and the gate does not open until day 14, so by the
    // time the idle arm is true this one has been true for two days. It can
    // never be the arm that decides whether EVD-R-007 fires.
    //
    // Measured 2026-08-09 with `computeTrainingLoad` over eight histories (3 to
    // 90 sessions, loads 30 to 200, 1 to 3 day spacing): at idle 11 every one
    // reads 23%, at idle 12 every one reads 25%, and at idle 14 the lowest is
    // 27%. The algebra agrees — CTL multiplies by (1 - 1/42) a day, so after 14
    // idle days at most 0.714 of the peak remains however large the peak was.
    unreachable:
      "collinear with detrainingMinIdleDays — 25% of chronic load is lost by idle day 12, two days " +
      "before the 14-day arm of the same `&&` opens the gate, so this arm is already true whenever " +
      "the rule can fire"
  },
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
  // Session rules only, for the reason DH-COV is scoped the same way: every
  // quantity below is read out of a session decision, and a threshold the plan
  // generator or the catalog applies has no reading in one. Listing those would
  // report four permanent failures naming a file that could never satisfy them.
  // The scoping is safe only because `appliedBy` is required and fingerprinted,
  // so a rule cannot leave this set quietly.
  return getRuleLibrary()
    .rules.filter((rule) => rule.status === "active" && rule.appliedBy === "session")
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
