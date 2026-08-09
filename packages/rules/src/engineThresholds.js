// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { getRuleLibrary } from "./library.js";
import { assertThresholdsMatch } from "./models.js";

/**
 * Which code reads which threshold, declared in one place.
 *
 * `assertThresholdsMatch` enforces the join in both directions — a number the
 * code applies but no rule declares fails the load, and so does a rule nobody
 * applies. That guard was written when one engine read every threshold, and the
 * list of keys lived in `decideSession.js` beside the code that read them, which
 * is where a claim about what code does belongs.
 *
 * It stopped fitting the moment a second piece of code started applying a rule.
 * The session engine asserting the full library would have been asserting keys
 * it does not read; each engine asserting only its own would have removed the
 * second direction entirely, because "no rule is unapplied" is not a question
 * any single engine can answer. Neither is acceptable: the second direction is
 * the one that catches a rule quietly becoming decoration.
 *
 * So the lists move here and stay separated by who reads them. The union is
 * asserted once, at the load of this module, and every engine imports its own
 * list from here — which means importing any engine still fails the process on a
 * mismatch, exactly as before. What is lost is the list sitting next to the code
 * it describes; what is kept is that adding a threshold still costs a deliberate
 * edit in two files, and that neither direction of the join has a hole in it.
 *
 * The engine name is not decoration either: it is what `decisionBasis` reports
 * as the code that applied the rule.
 */
export const ENGINE_THRESHOLD_KEYS = Object.freeze({
  // The session decision chain, which is more than one file: decideSession.js
  // applies the rules, and trainingLoad.js evaluates the two thresholds that
  // decide whether EVD-R-007 fires at all. An engine here is the chain that
  // produces one `decisionBasis`, not one module — splitting EVD-R-007's four
  // thresholds across two engine names would say they belong to two decisions,
  // and they belong to one.
  //
  //   packages/decision-engine/src/decideSession.js
  //   packages/training-load/src/trainingLoad.js  (the two detraining* keys)
  session: Object.freeze([
    "detrainingMinIdleDays",
    "detrainingMinCtlLossPct",
    "readinessRest",
    "readinessReduce",
    "readinessAdvance",
    "muscleFatigueMaxed",
    "muscleFatigueHigh",
    "muscleFatigueModerate",
    "acwrHigh",
    "recoveryCapMinutes",
    "returnDurationFactor",
    "returnSevereIdleDays",
    "returnSevereCtlLossPct",
    "restrictedMovementsPresent",
    "restrictionTokenMinLength"
  ]),
  // packages/planning/src/generatePlan.js
  plan: Object.freeze(["highImpactRestrictionPresent"]),
  // packages/planning/src/adaptPlan.js
  planChange: Object.freeze(["bodyRegionTokenMinLength", "injuryAffectedSessionsPresent"]),
  // packages/knowledge-graph/src/graph.js
  catalog: Object.freeze(["contraindicationTagsMatched"])
});

/**
 * Read at module load, so a mismatch is a startup failure rather than a wrong
 * decision discovered later.
 */
assertThresholdsMatch(getRuleLibrary(), Object.values(ENGINE_THRESHOLD_KEYS).flat());

/**
 * And the per-rule half of the same join.
 *
 * The union check above is satisfied by every threshold being read by *some*
 * engine, which is one question short. A rule declaring `appliedBy: "plan"` and
 * a threshold only the session engine reads passes it, and the claim it makes
 * to a reader — that the plan generator applies this number — is false. That is
 * the more likely mistake of the two, because `appliedBy` is prose-shaped and
 * copying a rule is how new rules get written.
 */
for (const rule of getRuleLibrary().rules) {
  const keys = ENGINE_THRESHOLD_KEYS[rule.appliedBy];
  if (!keys) {
    throw new Error(
      `Rule library invariant violated: ${rule.ruleId} is applied by "${rule.appliedBy}", which is ` +
        `not an engine declared here [${Object.keys(ENGINE_THRESHOLD_KEYS).join(", ")}].`
    );
  }
  const foreign = rule.thresholds.map((threshold) => threshold.key).filter((key) => !keys.includes(key));
  if (foreign.length > 0) {
    throw new Error(
      `Rule library invariant violated: ${rule.ruleId} says it is applied by "${rule.appliedBy}" but ` +
        `declares threshold(s) [${foreign.join(", ")}] that engine does not read. Either the rule ` +
        `belongs to another engine or that engine has not been taught to read its number.`
    );
  }
}
