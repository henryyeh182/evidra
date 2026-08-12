// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { LIBRARY_VERSION, describeRule } from "./library.js";
import { arbitrate, getPolicies } from "./arbitrate.js";
import { RELEASE_IDENTITY } from "../../release/src/index.js";

/**
 * The frame that says what a decision stands on, built the same way wherever a
 * decision is made.
 *
 * It lived inside `decideSession` while that was the only code applying rules,
 * and the shape it produced was documented as a contract three other tools did
 * not meet: a caller reading `decisionBasis` on a session decision and finding
 * nothing on a plan had no way to tell "no rule applies here" from "this path
 * never learned to say". Rebuilding the same object in each tool would have
 * given four shapes that agree until one of them is edited.
 *
 * `engineVersion` is a parameter rather than a constant because it is a claim
 * about which code applied the rule, and that is the caller's fact to state.
 *
 * @param {{ engineVersion: string, fired?: Array<{ ruleId: string, measured?: object|null, applied?: boolean }> }} input
 */
export function buildDecisionBasis({ engineVersion, fired = [] }) {
  const arbitration = arbitrate(fired.map((entry) => entry.ruleId));
  const readingFor = new Map(fired.map((entry) => [entry.ruleId, entry]));

  return {
    libraryVersion: LIBRARY_VERSION,
    engineVersion,
    releaseVersion: RELEASE_IDENTITY.releaseVersion,
    libraryChecksum: RELEASE_IDENTITY.libraryChecksum,
    policies: getPolicies(),
    governingRule: arbitration.governing
      ? describeRule(arbitration.governing.ruleId, readingFor.get(arbitration.governing.ruleId)?.measured)
      : null,
    appliedRules: arbitration.ordered.map((entry) => {
      const record = readingFor.get(entry.ruleId);
      const governing = entry.ruleId === arbitration.governing?.ruleId;
      return {
        ...describeRule(entry.ruleId, record?.measured, { full: false }),
        applied: record?.applied ?? true,
        ...(governing ? { governing: true } : {})
      };
    })
  };
}
