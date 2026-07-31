/**
 * Decision layer contracts.
 *
 * The distinction this package exists to enforce: a *recommendation* is emitted
 * from nothing ("today suits Zone 2") and any capable model can produce one. A
 * *decision* changes a prior state and carries from -> to, so it can only be
 * made by something that knows what was already scheduled.
 *
 * Every decision is reported as five layers:
 *   evidence -> state -> decision (intent) -> action (from/to) -> reason
 */

/**
 * @typedef {"keep" | "adjust" | "substitute" | "defer" | "advance"} DecisionType
 */

/**
 * A single observation the decision was grounded in. Reasons must trace back to
 * these; nothing may be asserted that has no evidence entry.
 *
 * @typedef {Object} EvidenceItem
 * @property {string} signal      e.g. "muscle_fatigue.legs", "readiness"
 * @property {number|string} value
 * @property {number|string} [baseline]  personal baseline when one exists
 * @property {string} [recordedAt]
 * @property {string} [source]
 */

/**
 * @typedef {Object} SessionShape
 * @property {string} [sessionId]
 * @property {string} focus
 * @property {string} type
 * @property {number} durationMinutes
 * @property {"low" | "moderate" | "high"} intensity
 * @property {string[]} exercises
 */

/**
 * @typedef {Object} SessionDecision
 * @property {EvidenceItem[]} evidence
 * @property {Object} state
 * @property {{ type: DecisionType, intent: string }} decision
 * @property {{ from: SessionShape | null, to: SessionShape | null, changed: string[] }} action
 * @property {string[]} reason
 * @property {"low" | "medium" | "high"} confidence
 * @property {{ recovery: { usable: string[], missing: string[] }, training: { usable: string[], missing: string[] } }} signalCoverage
 * @property {string[]} limits
 */

export const DECISION_TYPES = ["keep", "adjust", "substitute", "defer", "advance"];

/**
 * A decision is only well-formed if it carries the whole pipeline. This is the
 * structural guard against sliding back into recommendations.
 */
export function assertValidDecision(result) {
  if (!result || typeof result !== "object") {
    throw new Error("Decision must be an object.");
  }
  if (!DECISION_TYPES.includes(result.decision?.type)) {
    throw new Error(`Unknown decision type: ${result.decision?.type}`);
  }
  if (!Array.isArray(result.evidence)) {
    throw new Error("Decision must carry an evidence array.");
  }
  if (!result.action || !("from" in result.action) || !("to" in result.action)) {
    throw new Error("Decision must carry an action with from and to.");
  }
  if (!Array.isArray(result.reason) || result.reason.length === 0) {
    throw new Error("Decision must explain itself with at least one reason.");
  }
  // A non-keep decision has to actually change something, otherwise it is a
  // recommendation wearing a decision's clothes.
  if (result.decision.type !== "keep" && result.action.changed.length === 0) {
    throw new Error(`Decision type "${result.decision.type}" changed nothing.`);
  }
  return true;
}
