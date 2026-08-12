// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

export {
  THRESHOLDS,
  LIBRARY_VERSION,
  getRuleLibrary,
  getRule,
  getCategoryRank,
  describeRule
} from "./library.js";

export { arbitrate, orderByPriorityMatrix, combineIntensitySteps, getPolicies, describePolicies } from "./arbitrate.js";

export { buildDecisionBasis } from "./basis.js";
export { validateRuleCandidate } from "./candidate.js";
export { explainRuleForUser } from "./explanation.js";

export { ENGINE_THRESHOLD_KEYS } from "./engineThresholds.js";

export {
  PARAMETERS,
  PARAMETER_SET_VERSION,
  getParameterSet,
  getParameter,
  assertParametersMatch,
  assertValidParameterSet
} from "./parameters.js";

export {
  assertValidRuleLibrary,
  assertThresholdsMatch,
  deriveEvidenceLevel,
  CATEGORY_IDS,
  EVIDENCE_LEVELS,
  STUDY_DESIGNS,
  RECOMMENDATION_STRENGTHS,
  VERIFICATION_STATUSES,
  BASES
} from "./models.js";
