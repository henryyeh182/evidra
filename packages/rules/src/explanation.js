import { describeRule } from "./library.js";
function thresholdText(threshold) { return `${threshold.key} ${threshold.operator} ${threshold.value} ${threshold.unit}`; }
/** Deterministic user-facing explanation of an already loaded Rule. */
export function explainRuleForUser(ruleId, measured = null) {
  const rule = describeRule(ruleId, measured);
  const basis = rule.basis === "internal_composite"
    ? "This threshold is Pacevera's own composite heuristic, not a number established by a study."
    : rule.sources.length
      ? "This rule uses an externally defined metric; the cited sources support the stated scope, not automatically every threshold."
      : "This rule uses an external metric, but no source is attached to this decision.";
  return { ruleId: rule.ruleId, title: rule.title, summary: `Pacevera used this rule to decide: ${rule.title.toLowerCase()}.`, whatItChecked: rule.thresholds.map(thresholdText), whyItMatters: basis, evidence: { studyDesign: rule.evidence.studyDesign, recommendationStrength: rule.evidence.recommendationStrength, sourceCount: rule.sources.length, verificationStatuses: [...new Set(rule.sources.map((source) => source.verificationStatus))] }, limitations: rule.limitations, runtimeIdentity: { ruleVersion: rule.ruleVersion } };
}
