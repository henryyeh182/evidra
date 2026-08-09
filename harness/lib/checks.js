// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The invariants. Every one of them runs against every scenario.
 *
 * That is the structural difference between this file and
 * `packages/rules/test/regression.test.js`, which is the other place decisions
 * are pinned. A regression case asserts what one input produces; adding an
 * input there means writing new assertions, so the set of things being checked
 * grows only when someone remembers to grow it. Here the assertions are fixed
 * and the inputs are the variable: a scenario added tomorrow is checked against
 * all seven without anyone touching this file, and a check added here applies
 * retroactively to every scenario already written.
 *
 * Each check answers one question that was asked of the decision chain, and the
 * question is stated in its own words rather than as a name — a check whose
 * purpose has to be inferred from an identifier is a check that gets weakened
 * the first time it goes red.
 */

import { RULES } from "../../packages/decision-engine/src/index.js";
import { arbitrate, getCategoryRank, getRule } from "../../packages/rules/src/index.js";
import { runChain, withoutMetrics } from "./chain.js";

/** The four recovery signals `signalCoverage.recovery` reports on. */
const RECOVERY_SIGNALS = ["sleep", "hrv", "restingHeartRate", "stress"];

/** Which health metric types feed each of them. Dropping these is the ablation. */
const METRICS_BEHIND = {
  sleep: ["sleep_duration_hours", "sleep_quality"],
  hrv: ["hrv_ms"],
  restingHeartRate: ["resting_hr_bpm"],
  stress: ["stress"]
};

const CONFIDENCE_ORDER = ["low", "medium", "high"];

// ---- DH-1: does the same evidence always produce the same decision? --------

const determinism = {
  id: "DH-1",
  question: "Does the same evidence always produce the same decision?",
  async run({ scenario, decision }) {
    const failures = [];

    const again = await runChain(scenario);
    if (JSON.stringify(again.decision) !== JSON.stringify(decision)) {
      failures.push(
        "two runs of the same scenario produced different decisions — something in the chain " +
          "is reading a clock, a random number, or state left over from the previous call"
      );
    }

    // The other half of determinism: the chain must not write to the evidence
    // it was handed. Phase 1 is stateless and the caller holds the plan, so the
    // same object goes to more than one tool; a chain that reorders or rewrites
    // it changes what the *next* call decides.
    try {
      await runChain(scenario, { freeze: true });
    } catch (error) {
      const site = String(error.stack || "")
        .split("\n")
        .find((line) => line.includes("packages/"));
      failures.push(
        `the chain modifies the caller's own evidence: ${error.message}` +
          (site ? ` (${site.trim()})` : "")
      );
    }

    return failures;
  }
};

// ---- DH-2: does every decision carry from -> to? ---------------------------

const COMPARED_FIELDS = ["focus", "type", "durationMinutes", "intensity"];

function differingFields(from, to) {
  if (!from || !to) return [];
  const changed = COMPARED_FIELDS.filter((field) => from[field] !== to[field]);
  if (JSON.stringify(from.exerciseIds) !== JSON.stringify(to.exerciseIds)) changed.push("exercises");
  return changed;
}

const fromTo = {
  id: "DH-2",
  question: "Does every decision carry from -> to, and does `changed` say the truth about it?",
  run({ scenario, decision }) {
    const failures = [];
    const { from, to } = decision.action;

    if (!scenario.scheduledSession) {
      // No prior state, no decision — the one case where from and to are null
      // by design. What must not happen is a session being invented to fill it.
      if (from !== null || to !== null) {
        failures.push("nothing was scheduled, yet the action names a session to change from or to");
      }
      return failures;
    }

    if (!from || !to) {
      failures.push("a scheduled session was supplied but the action is missing from or to");
      return failures;
    }

    const actual = differingFields(from, to);
    const claimed = decision.action.changed;

    for (const field of claimed) {
      if (!actual.includes(field)) {
        failures.push(`\`changed\` lists ${field}, but from and to hold the same value for it`);
      }
    }
    for (const field of actual) {
      if (!claimed.includes(field)) {
        failures.push(
          `${field} differs between from and to but is absent from \`changed\` — a change the ` +
            `caller has no way to see`
        );
      }
    }

    if (decision.decision.type !== "keep" && claimed.length === 0) {
      failures.push(`decision type "${decision.decision.type}" changed nothing`);
    }
    if (decision.decision.type === "keep" && actual.length > 0) {
      failures.push(
        `the decision is "keep" but the session actually changed (${actual.join(", ")}) — ` +
          `a change presented as no change`
      );
    }

    return failures;
  }
};

// ---- DH-3: can every reason be traced back to evidence? --------------------

/**
 * The numbers a reason is allowed to quote, and why each is admissible.
 *
 * This set is the whole check, so it is enumerated rather than widened until
 * things pass. A number outside it is one the athlete cannot follow back to
 * anything: not a reading that arrived, not a threshold the library declares,
 * not a figure from the session in front of them.
 */
function groundedNumbers({ decision, scenario }) {
  const grounded = new Set();
  const add = (value) => {
    if (typeof value === "number") grounded.add(String(value));
  };

  // Readings that arrived.
  for (const item of decision.evidence) add(item.value);
  // Thresholds the library declares. `returnDurationFactor` is quoted as a
  // percentage ("70% of planned"), which is the same declared number in the
  // unit a person reads it in.
  for (const value of Object.values(RULES)) {
    add(value);
    if (value < 1) add(Math.round(value * 100));
  }
  // The session itself, before and after. A reason that says the duration came
  // down from 60 to 45 is quoting the action beside it.
  for (const shape of [decision.action.from, decision.action.to, scenario.proposedSession]) {
    if (shape) add(shape.durationMinutes);
  }
  return grounded;
}

const reasonGrounding = {
  id: "DH-3",
  question: "Does every reason trace back to evidence, a stated threshold, or the session itself?",
  run({ scenario, decision }) {
    const failures = [];
    const grounded = groundedNumbers({ decision, scenario });

    // Names echoed back from the input are not claims, and their digits are not
    // quantities: "VO2max Intervals" contains a 2 that nobody measured. They
    // are removed before the line is scanned rather than excused afterwards, so
    // a genuine number sitting next to a session name is still caught.
    const echoed = [
      decision.action.from?.focus,
      decision.action.to?.focus,
      decision.action.from?.type,
      decision.action.to?.type,
      ...(decision.action.from?.exercises || []),
      ...(decision.action.to?.exercises || []),
      ...(decision.state.targetMuscleFatigue ? [decision.state.targetMuscleFatigue.group] : [])
    ].filter((value) => typeof value === "string" && /\d/.test(value));

    for (const line of decision.reason) {
      let scanned = line;
      for (const name of echoed) scanned = scanned.split(name).join(" ");
      for (const number of scanned.match(/\d+(\.\d+)?/g) || []) {
        if (!grounded.has(number)) {
          failures.push(
            `a reason quotes ${number}, which is neither a reading in \`evidence\`, a threshold ` +
              `in the rule library, nor a figure from the session: "${line}"`
          );
        }
      }
    }

    return failures;
  }
};

// ---- DH-4: did a rule actually govern the decision? ------------------------

const ruleGoverns = {
  id: "DH-4",
  question: "Is the decision attributed to the rule the arbitration policy says governs it?",
  run({ decision }) {
    const failures = [];
    const basis = decision.decisionBasis;

    if (!basis) {
      failures.push("the decision carries no decisionBasis at all");
      return failures;
    }

    const fired = basis.appliedRules.map((rule) => rule.ruleId);

    if (fired.length === 0) {
      if (basis.governingRule) {
        failures.push(
          `no rule fired, yet the decision is attributed to ${basis.governingRule.ruleId}`
        );
      }
      // A decision nothing fired on must not be presenting itself as a change.
      if (decision.decision.type !== "keep") {
        failures.push(
          `the session was ${decision.decision.type}ed with no rule behind it — a change the rule ` +
            `library cannot account for`
        );
      }
      return failures;
    }

    if (!basis.governingRule) {
      failures.push(`${fired.length} rule(s) fired but the decision names none as governing`);
      return failures;
    }

    // Recomputed from the fired set rather than trusted: this is the one field
    // that says which rule the athlete is being told to hold responsible.
    const expected = arbitrate(fired).governing?.ruleId;
    if (basis.governingRule.ruleId !== expected) {
      failures.push(
        `${basis.governingRule.ruleId} is reported as governing, but the arbitration policy ` +
          `(${basis.policies.arbitration}) puts ${expected} first`
      );
    }

    const governingRank = getCategoryRank(getRule(basis.governingRule.ruleId).category);
    for (const ruleId of fired) {
      if (getCategoryRank(getRule(ruleId).category) < governingRank) {
        failures.push(
          `${ruleId} outranks the governing rule ${basis.governingRule.ruleId} by category and was ` +
            `not chosen`
        );
      }
    }

    const flagged = basis.appliedRules.filter((rule) => rule.governing === true);
    if (flagged.length !== 1 || flagged[0]?.ruleId !== basis.governingRule.ruleId) {
      failures.push(
        `\`appliedRules\` marks ${flagged.length} rule(s) as governing; exactly one must be, and it ` +
          `must be ${basis.governingRule.ruleId}`
      );
    }

    return failures;
  }
};

// ---- DH-5: does a rule that lost still leave a trace? ----------------------

const overruledTrace = {
  id: "DH-5",
  question: "Does a rule that fired and did not govern still leave a trace?",
  run({ decision }) {
    const failures = [];
    const basis = decision.decisionBasis;
    if (!basis) return failures; // DH-4 reports this

    const seen = new Set();
    for (const rule of basis.appliedRules) {
      if (seen.has(rule.ruleId)) {
        failures.push(
          `${rule.ruleId} appears twice in appliedRules — one rule, two readings, and no way to ` +
            `tell which one the decision rests on`
        );
      }
      seen.add(rule.ruleId);

      // Identity and basis survive in the compact form by design; the reading
      // is what makes the trace usable, and it is the field most easily lost
      // when a rule is recorded from somewhere that does not have it to hand.
      if (!rule.measured) {
        failures.push(`${rule.ruleId} is recorded without the reading that triggered it`);
      }
      if (!rule.basis) {
        failures.push(`${rule.ruleId} is recorded without saying what its threshold rests on`);
      }
    }

    // The point of the check. A rule that lost arbitration must still be in the
    // record; if it were dropped, `decisionBasis` would read as though only one
    // rule had anything to say.
    const overruled = arbitrate([...seen]).overruled.map((entry) => entry.ruleId);
    for (const ruleId of overruled) {
      if (!seen.has(ruleId)) {
        failures.push(`${ruleId} was overruled and dropped from the record`);
      }
    }

    // A rule that triggered but could not act is the case most likely to be
    // silently discarded, because nothing in the output changed on its account.
    for (const rule of basis.appliedRules) {
      if (rule.applied === false && !decision.limits.some((limit) => limit.length > 0)) {
        failures.push(
          `${rule.ruleId} triggered and could not be applied, and no limit says so — the athlete ` +
            `is shown an unexplained non-change`
        );
      }
    }

    return failures;
  }
};

// ---- DH-6: does a missing signal lower confidence rather than get filled? --

const noFabrication = {
  id: "DH-6",
  question: "Does a missing signal lower confidence rather than get filled in?",
  async run({ scenario, state, engineState, decision }) {
    const failures = [];
    const coverage = decision.signalCoverage;

    // 1. A signal reported missing must not be sitting in the state as a value.
    for (const signal of coverage.recovery.missing) {
      if (signal === "sleep" && state.sleepQuality != null) {
        failures.push("sleep is reported missing and a sleep quality score was produced anyway");
      }
    }

    // 2. No readiness reading means no readiness in the evidence. This is the
    //    fabrication that would be hardest to spot downstream: a stand-in
    //    readiness is indistinguishable from a measured one once it is a number
    //    in a list.
    if (state.readinessScore === null) {
      if (decision.evidence.some((item) => item.signal === "readiness")) {
        failures.push(
          "readiness was not scored, yet it appears in `evidence` as though it had been measured"
        );
      }
      if (decision.state.readiness !== null) {
        failures.push("readiness was not scored, yet the state reports a value for it");
      }
    }

    // 3. Every evidence entry has to correspond to something the state actually
    //    holds. An entry with no counterpart is a number the engine minted.
    const stateValue = {
      readiness: () => engineState.readinessScore,
      acute_chronic_workload_ratio: () => engineState.acuteChronicWorkloadRatio,
      days_since_last_session: () => engineState.trainingLoad?.detraining?.daysSinceLastSession,
      chronic_load_loss_pct: () => engineState.trainingLoad?.detraining?.ctlLossPct
    };
    for (const item of decision.evidence) {
      const lookup = stateValue[item.signal];
      if (lookup && lookup() !== item.value) {
        failures.push(
          `evidence reports ${item.signal} = ${item.value}, which is not what the state holds ` +
            `(${lookup()})`
        );
      }
      if (item.signal.startsWith("muscle_fatigue.")) {
        const group = item.signal.slice("muscle_fatigue.".length);
        if (engineState.muscleFatigue[group] !== item.value) {
          failures.push(
            `evidence reports ${item.signal} = ${item.value}, which is not the fatigue the state ` +
              `computed for ${group} (${engineState.muscleFatigue[group]})`
          );
        }
      }
    }

    // 4. The ablation. Take a signal away and the gap has to show up as a gap:
    //    named in coverage, and confidence no higher than it was with the
    //    signal present. Nothing here asserts confidence *falls* — dropping one
    //    of four signals need not cross a band boundary — only that removing
    //    evidence never makes the system surer of itself.
    for (const signal of RECOVERY_SIGNALS) {
      if (!coverage.recovery.usable.includes(signal)) continue;

      const ablated = await runChain(withoutMetrics(scenario, METRICS_BEHIND[signal]));
      const after = ablated.decision.signalCoverage.recovery;

      if (!after.missing.includes(signal)) {
        failures.push(
          `${signal} was removed from the evidence and does not appear in ` +
            `signalCoverage.recovery.missing — the caller is never told it is gone`
        );
      }
      if (after.usable.includes(signal)) {
        failures.push(`${signal} was removed from the evidence and is still reported as usable`);
      }

      const before = CONFIDENCE_ORDER.indexOf(decision.confidence);
      const now = CONFIDENCE_ORDER.indexOf(ablated.decision.confidence);
      if (now > before) {
        failures.push(
          `removing ${signal} raised confidence from ${decision.confidence} to ` +
            `${ablated.decision.confidence}`
        );
      }
    }

    return failures;
  }
};

// ---- DH-7: does injury really outrank recovery and training goal? ---------

const injuryPrecedence = {
  id: "DH-7",
  question: "Does an injury restriction really outrank recovery and training goal?",
  run({ scenario, decision }) {
    const failures = [];
    const basis = decision.decisionBasis;
    if (!basis) return failures;

    const injuryRules = basis.appliedRules.filter((rule) => rule.category === "injury");

    if (injuryRules.length > 0) {
      // Attribution.
      if (basis.governingRule?.category !== "injury") {
        failures.push(
          `${injuryRules.map((r) => r.ruleId).join(", ")} fired, but the decision is attributed to ` +
            `${basis.governingRule?.ruleId ?? "no rule"} (${basis.governingRule?.category ?? "none"})`
        );
      }

      // Substance. Attribution without effect would be a decision that names
      // the injury rule and still prescribes the movement.
      const removed = injuryRules.flatMap((rule) => [
        ...(rule.measured?.inScheduledSession || []),
        ...(rule.measured?.inProposal || [])
      ]);
      const stillThere = (decision.action.to?.exercises || []).filter((name) =>
        removed.includes(name)
      );
      if (stillThere.length > 0) {
        failures.push(
          `an injury rule named ${stillThere.join(", ")} as restricted and the session still ` +
            `prescribes it`
        );
      }
    }

    // Progression must never win over a live restriction, whether or not any
    // movement matched: "avoid hip" matches nothing (the token is too short to
    // pass restrictionTokenMinLength) and the restriction is no less live for
    // it.
    const restrictions = (scenario.evidence.constraints?.injuries || [])
      .filter((injury) => (injury.status ?? "active") === "active")
      .flatMap((injury) => injury.restrictions || []);
    if (restrictions.length > 0 && decision.decision.type === "advance") {
      failures.push(
        `intensity was raised while ${restrictions.length} restriction(s) are in force`
      );
    }

    return failures;
  }
};

// ---- DH-PIN: does the decision still come out the way the scenario pins it? --

/**
 * The one check that is not an invariant.
 *
 * Everything above holds of any decision; this holds of one. A scenario may
 * carry `expectedDecision`, and whatever it names is asserted — nothing more.
 * A scenario that pins only `type` is making only that claim, and the check
 * says nothing about the rest.
 *
 * Kept deliberately thin, because the thing it is good at is also the thing it
 * is dangerous for. Pinning an output catches any change to it, including the
 * changes that were right, so a fat pin turns every deliberate improvement into
 * a wall of diffs and trains whoever is reading them to update the expectations
 * without looking. The invariants above are what should catch a decision going
 * wrong; this catches a decision going *different*, which is a weaker and more
 * fragile thing to know.
 */
const pinnedDecision = {
  id: "DH-PIN",
  question: "Does the decision still come out the way the scenario pins it?",
  run({ scenario, decision }) {
    const expected = scenario.expectedDecision;
    if (!expected) return [];

    const failures = [];
    const compare = (label, actual, wanted) => {
      if (wanted === undefined) return;
      if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
        failures.push(
          `${label}: pinned ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`
        );
      }
    };

    compare("decision.type", decision.decision.type, expected.type);
    compare("decision.intent", decision.decision.intent, expected.intent);
    compare("confidence", decision.confidence, expected.confidence);

    // Coverage and confidence, for the scenarios whose whole subject they are.
    //
    // DH-6 asks the general question — a signal taken away must be reported and
    // must not make the system surer of itself — and it asks it of every
    // scenario. What it cannot say is which signals a particular scenario is
    // short of, or what confidence that shortfall is supposed to land on: an
    // engine that quietly promoted a three-signal day to `high` would pass DH-6
    // in full, because nothing was removed. So the missing-evidence scenarios
    // name their own coverage and their own confidence, and only they do.
    //
    // Named group by group and list by list rather than as a whole object, so a
    // scenario claiming `recovery.missing` is claiming that and nothing about
    // the training half. Sorted before comparing: the order these lists come
    // out in is the order the signals happen to be enumerated in, and no
    // scenario should be pinning that.
    for (const group of ["recovery", "training"]) {
      const wantedGroup = expected.signalCoverage?.[group];
      if (!wantedGroup) continue;
      for (const list of ["usable", "missing"]) {
        if (wantedGroup[list] === undefined) continue;
        compare(
          `signalCoverage.${group}.${list}`,
          [...(decision.signalCoverage?.[group]?.[list] || [])].sort(),
          [...wantedGroup[list]].sort()
        );
      }
    }

    compare(
      "governing rule",
      decision.decisionBasis?.governingRule?.ruleId ?? null,
      expected.governingRule
    );
    compare("action.changed", decision.action.changed, expected.changed);

    for (const [field, wanted] of Object.entries(expected.to || {})) {
      compare(`action.to.${field}`, decision.action.to?.[field], wanted);
    }

    // Which rules fired, as a set: order is the arbitration policy's business
    // and DH-4 already checks it.
    if (expected.firedRules) {
      const fired = (decision.decisionBasis?.appliedRules || []).map((rule) => rule.ruleId).sort();
      compare("fired rules", fired, [...expected.firedRules].sort());
    }

    // Which rules fired and lost. Derived rather than read: `decisionBasis` has
    // no `overruledRules` field, and the information is in what it does carry —
    // every rule in `appliedRules` that is not the governing one was overruled.
    // Pinning it separately from `firedRules` is the point: a rule can keep
    // firing while quietly changing sides, and "fired" alone would not show it.
    if (expected.overruledRules) {
      const overruled = (decision.decisionBasis?.appliedRules || [])
        .filter((rule) => rule.governing !== true)
        .map((rule) => rule.ruleId)
        .sort();
      compare("overruled rules", overruled, [...expected.overruledRules].sort());
    }

    return failures;
  }
};

export const CHECKS = [
  determinism,
  fromTo,
  reasonGrounding,
  ruleGoverns,
  overruledTrace,
  noFabrication,
  injuryPrecedence,
  pinnedDecision
];
