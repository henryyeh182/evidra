// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Rule coverage: every rule in the library has to be reachable here.
 *
 * The seven invariants are properties of a decision, and they are checked once
 * per scenario. This is a property of the *set*, and it cannot be: no single
 * scenario can say whether some other rule went unexercised. It is what makes
 * the harness a place a rule can be re-run and traced rather than a sample of
 * whichever rules the scenarios happened to hit.
 *
 * Why it belongs here as well as in `packages/rules/test/regression.test.js`.
 * That set pins one rule per case against a hand-written state — the threshold
 * is protected, and the rule is never asked to survive a whole chain. This one
 * asks a different question: does the rule still fire when the state it reads
 * was computed from evidence rather than written down? A rule can be intact and
 * unreachable, and only a check that starts from evidence can tell.
 */

import { getRuleLibrary } from "../../packages/rules/src/index.js";

/**
 * @param {{ scenario: object, result: object }[]} runs
 * @returns {{ covered: Map<string, string[]>, uncovered: string[], active: string[] }}
 */
export function ruleCoverage(runs) {
  const covered = new Map();
  for (const { scenario, result } of runs) {
    for (const rule of result.decision.decisionBasis?.appliedRules || []) {
      if (!covered.has(rule.ruleId)) covered.set(rule.ruleId, []);
      covered.get(rule.ruleId).push(scenario.id);
    }
  }

  // Scoped to the rules this harness can actually reach.
  //
  // Every scenario here drives one call: evidence in, a session decision out.
  // A rule the plan generator or the exercise catalog applies cannot fire on
  // that call no matter what a scenario contains, so leaving those rules in
  // `uncovered` would report them as gaps the harness could close and it never
  // could. Scoping is only honest if something else is on the hook for them,
  // which is why `appliedBy` is required on every rule and why each of the
  // other engines carries its own coverage test — a rule reassigned to an
  // engine drops out of this list and into that one, and the fingerprint goes
  // red when it moves.
  const active = getRuleLibrary()
    .rules.filter((rule) => rule.status === "active" && rule.appliedBy === "session")
    .map((rule) => rule.ruleId);

  return {
    covered,
    active,
    uncovered: active.filter((ruleId) => !covered.has(ruleId))
  };
}
