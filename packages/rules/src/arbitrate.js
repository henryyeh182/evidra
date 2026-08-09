// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { getRule, getCategoryRank, getRuleLibrary } from "./library.js";

/**
 * The Priority Matrix.
 *
 *   injury > illness > recovery > training_goal > preference
 *
 * Arbitration answers one question and one only: when several rules fire, which
 * one is the decision attributed to? It does not decide how large the change
 * is. That is the combination policy, and the two are kept apart deliberately —
 * the most important rule is not always the one demanding the biggest
 * reduction, and conflating them makes both unexplainable.
 *
 * Worked example. A high-fatigue rule (recovery, one step down) and a
 * progression rule (training_goal, one step up) both trigger. Arbitration puts
 * recovery first by category rank, so the decision is attributed to the fatigue
 * rule and the progression rule is recorded as overruled — which is what the
 * athlete needs to read. Combination separately resolves the effects.
 */
export function arbitrate(triggeredRuleIds) {
  const entries = [...new Set(triggeredRuleIds)]
    .map((ruleId) => {
      const rule = getRule(ruleId);
      return { ruleId, rank: getCategoryRank(rule.category), priority: rule.priority, category: rule.category };
    })
  const ordered = orderByPriorityMatrix(entries);

  return {
    governing: ordered[0] ?? null,
    ordered,
    // Named so a caller can show "we also saw these, and they lost".
    overruled: ordered.slice(1)
  };
}

export function orderByPriorityMatrix(entries) {
  return entries
    .map((entry) => ({
      ...entry,
      rank: entry.rank ?? getCategoryRank(entry.category)
    }))
    .sort((a, b) => a.rank - b.rank || b.priority - a.priority || a.ruleId.localeCompare(b.ruleId));
}

/**
 * How the effects of several triggered rules combine.
 *
 * `most_restrictive_wins`: intensity reductions do not sum. Two rules each
 * asking for one step down produce one step down, not two — they are two
 * readings of the same tired athlete, not two independent reasons to stop.
 * Summing them was the obvious alternative and it is wrong for exactly that
 * reason: it would let a well-instrumented athlete be penalised twice for a
 * single fact simply because more devices observed it.
 *
 * A progression rule (negative steps) can never pull the result above zero
 * while any reduction is present, which is what keeps EVD-R-008 from
 * cancelling a recovery rule.
 */
export function combineIntensitySteps(steps) {
  if (steps.length === 0) return 0;
  const reductions = steps.filter((step) => step > 0);
  if (reductions.length > 0) return Math.max(...reductions);
  return Math.max(...steps.map((step) => Math.min(step, 0)));
}

/**
 * The policy identifiers, which travel with every decision.
 *
 * Identifiers only. The prose that defines them is the same on every call and
 * was costing 891 bytes of each response to repeat — it belongs in the server's
 * `instructions`, sent once at initialize, not stapled to each answer. What has
 * to stay per-decision is which policy was in force, so that a decision remains
 * auditable on its own: if the arbitration rule ever changes, old outputs still
 * say which one produced them.
 */
export function getPolicies() {
  const library = getRuleLibrary();
  return { arbitration: library.arbitrationPolicy.id, combination: library.combinationPolicy.id };
}

/** The full prose, for the server's initialize instructions. */
export function describePolicies() {
  const library = getRuleLibrary();
  return { arbitration: library.arbitrationPolicy, combination: library.combinationPolicy };
}
