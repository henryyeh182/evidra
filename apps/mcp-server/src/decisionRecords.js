// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { randomUUID } from "node:crypto";
import { arbitrate, combineIntensitySteps } from "../../../packages/rules/src/index.js";

const MAX_RECORDS = 256;
const RECORD_TTL_MS = 15 * 60 * 1000;
const decisions = new Map();
const outcomes = new Map();

function prune(now = Date.now()) {
  for (const [id, record] of decisions) {
    if (now - record.createdAt > RECORD_TTL_MS) decisions.delete(id);
  }
  while (decisions.size > MAX_RECORDS) decisions.delete(decisions.keys().next().value);
}

export function recordDecision(payload, { userId = null, evidenceSource = "provided" } = {}) {
  prune();
  const decisionId = payload.decisionId || `dec_${randomUUID()}`;
  decisions.set(decisionId, {
    decisionId,
    createdAt: Date.now(),
    userId,
    evidenceSource,
    trace: {
      decision: payload.decision ?? null,
      action: payload.action ?? null,
      reason: payload.reason ?? [],
      evidence: payload.evidence ?? null,
      decisionBasis: payload.decisionBasis ?? null,
      provenance: payload.provenance ?? null
    }
  });
  return { decisionId, ...payload };
}

export function explainDecision(decisionId) {
  prune();
  return decisions.get(decisionId) || null;
}

export function submitOutcome(caseId, outcome) {
  const event = {
    outcomeId: `out_${randomUUID()}`,
    caseId,
    outcome,
    recordedAt: new Date().toISOString()
  };
  const list = outcomes.get(caseId) || [];
  list.push(event);
  outcomes.set(caseId, list);
  return { event, totalForCase: list.length, persistence: "process_local" };
}

export function resolveConflict(triggeredRules) {
  if (!Array.isArray(triggeredRules)) throw new Error("triggeredRules must be an array.");
  const ruleIds = triggeredRules.map((entry) => typeof entry === "string" ? entry : entry.ruleId);
  const arbitration = arbitrate(ruleIds);
  const effects = triggeredRules
    .map((entry) => typeof entry === "string" ? null : entry.effect)
    .filter((effect) => effect && Number.isFinite(effect.intensitySteps));
  const intensitySteps = combineIntensitySteps(effects.map((effect) => effect.intensitySteps));
  return {
    governingRule: arbitration.governing,
    orderedRules: arbitration.ordered,
    overruledRules: arbitration.overruled,
    intensitySteps,
    reason: arbitration.governing
      ? `${arbitration.governing.ruleId} governs by the priority matrix; overruled rules remain recorded.`
      : "No triggered rule was supplied."
  };
}

export function clearDecisionRecordsForTests() {
  decisions.clear();
  outcomes.clear();
}
