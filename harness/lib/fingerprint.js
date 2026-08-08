// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The fingerprint of every field that can move a decision.
 *
 * Why this exists rather than a line in a document saying "run the harness
 * after a rule edit". Documents do not fail. This repo has already written down
 * that writing something down is not the same as it happening, so the rule is
 * enforced by something that goes red.
 *
 * What it catches that nothing else does. DH-PIN fails when a rule edit changes
 * a decision, which is the easy case — you see it immediately. The dangerous
 * edit is the one that changes no decision *in this scenario set*: widen
 * `acwrHigh` from 1.4 to 1.6 and every check here still passes, because no
 * scenario sits between the two. Nothing has gone wrong yet and nothing tells
 * you that the guarantee moved. The fingerprint has no opinion about decisions:
 * it fails on the edit itself, and the edit is what wanted looking at.
 *
 * The cost is deliberate. Updating `harness/rule-fingerprint.json` is a second
 * edit in a second file, the same shape of guard as `assertThresholdsMatch`,
 * and for the same reason: a change to what the engine guarantees should not be
 * possible in one place without noticing.
 */

import { createHash } from "node:crypto";

import { getRuleLibrary } from "../../packages/rules/src/index.js";

/**
 * The fields that decide things, and nothing else.
 *
 * `thresholds`, `category` and `effect` are the three that were asked for.
 * `priority` travels with `category` because the arbitration policy is
 * `category_then_priority`: within one category, a priority edit moves which
 * rule the decision is attributed to exactly as a category edit does across
 * them, and a fingerprint that watched one but not the other would be a guard
 * with a hole in the shape of a number.
 *
 * Everything else is deliberately outside. Retitling a rule, correcting a
 * citation, adding a limitation or rewriting `notes` cannot change a decision,
 * and a fingerprint that went red for prose would be turned off within a week.
 */
function governingFields(rule) {
  return {
    ruleId: rule.ruleId,
    status: rule.status,
    category: rule.category,
    priority: rule.priority,
    thresholds: (rule.thresholds || []).map((threshold) => ({
      key: threshold.key,
      operator: threshold.operator,
      value: threshold.value,
      unit: threshold.unit
    })),
    effect: rule.effect ?? null
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/**
 * One rule's digest. Exported so the boundary can be tested directly — the
 * library is frozen, so the only way to ask "does a retitle move this?" is to
 * hand this function two objects rather than to edit a real rule.
 */
export function fingerprintRule(rule) {
  return digest(governingFields(rule));
}

/**
 * @returns {{ libraryVersion: string, policies: object, rules: Record<string, string> }}
 */
export function computeFingerprint() {
  const library = getRuleLibrary();
  return {
    readMe: [
      "Generated. Do not hand-edit a hash.",
      "",
      "One digest per rule over the fields that can move a decision: category,",
      "priority, thresholds, effect, status. Prose is deliberately outside — a",
      "retitled rule or a corrected citation must not turn this red, or it gets",
      "turned off.",
      "",
      "When a test points here, the file is not the problem. Run `npm run harness`",
      "and read what the decisions became; the answer may be that nothing moved,",
      "which is worth knowing rather than assuming. Then regenerate:",
      "",
      "    node harness/runner.js --update-fingerprint",
      "",
      "and commit the result alongside the rule edit, so the diff shows both the",
      "threshold that changed and the acknowledgement that someone looked."
    ],
    // Recorded, not hashed into the rules: a version bump is the correct
    // accompaniment to a threshold edit, so it must not be what makes the
    // fingerprint move.
    libraryVersion: library.version,
    // The two policies decide how rules combine and which one is credited, so
    // they move decisions without any rule changing at all.
    policies: digest({
      arbitration: library.arbitrationPolicy.id,
      combination: library.combinationPolicy.id,
      categories: library.categories?.map((category) => category.id) ?? null
    }),
    rules: Object.fromEntries(
      [...library.rules]
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
        .map((rule) => [rule.ruleId, digest(governingFields(rule))])
    )
  };
}

/**
 * Compare the library against a stored fingerprint.
 *
 * @returns {{ changed: string[], added: string[], removed: string[], policiesMoved: boolean }}
 */
export function compareFingerprint(stored) {
  const current = computeFingerprint();
  const storedRules = stored.rules || {};

  return {
    current,
    policiesMoved: stored.policies !== current.policies,
    added: Object.keys(current.rules).filter((ruleId) => !(ruleId in storedRules)),
    removed: Object.keys(storedRules).filter((ruleId) => !(ruleId in current.rules)),
    changed: Object.keys(current.rules).filter(
      (ruleId) => ruleId in storedRules && storedRules[ruleId] !== current.rules[ruleId]
    )
  };
}
