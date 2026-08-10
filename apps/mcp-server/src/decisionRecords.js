// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { createHash, randomUUID } from "node:crypto";
import { arbitrate, combineIntensitySteps } from "../../../packages/rules/src/index.js";
import { LIBRARY_VERSION } from "../../../packages/rules/src/index.js";
import { ENGINE_VERSION } from "../../../packages/decision-engine/src/version.js";

const MAX_RECORDS = 256;
const RECORD_TTL_MS = 15 * 60 * 1000;
export function createDecisionRecordStore({ maxRecords = MAX_RECORDS, ttlMs = RECORD_TTL_MS } = {}) {
  const records = new Map();
  return {
    maxRecords,
    ttlMs,
    get: (id) => records.get(id),
    set: (id, record) => records.set(id, record),
    delete: (id) => records.delete(id),
    entries: () => records.entries(),
    get size() { return records.size; },
    clear: () => records.clear()
  };
}

// The default is process-local for the MCP bundle, while the adapter boundary
// lets a hosted deployment provide durable storage without changing any tool
// contract or creating per-tool trace formats.
let decisionStore = createDecisionRecordStore();
const outcomes = new Map();

function prune(now = Date.now()) {
  for (const [id, record] of decisionStore.entries()) {
    if (now - record.createdAt > decisionStore.ttlMs) decisionStore.delete(id);
  }
  while (decisionStore.size > decisionStore.maxRecords) decisionStore.delete(decisionStore.entries().next().value[0]);
}

export function recordDecision(payload, { userId = null, evidenceSource = "provided" } = {}) {
  prune();
  const decisionId = payload.decisionId || `dec_${createHash("sha256")
    .update(JSON.stringify({ payload, userId, evidenceSource }))
    .digest("hex")
    .slice(0, 24)}`;
  const createdAt = Date.now();
  const basis = payload.decisionBasis ?? null;
  const provenance = payload.provenance ?? null;
  const record = {
    decisionId,
    createdAt,
    userId,
    evidenceSource,
    tool: payload.tool ?? null,
    trace: {
      decision: payload.decision ?? null,
      // These canonical nodes are intentionally present even when a tool has
      // no governing rule. An empty rule list means "evaluated, none fired",
      // not "this tool was never registered".
      rules: basis ? {
        governing: basis.governingRule ?? null,
        applied: basis.appliedRules ?? [],
        libraryVersion: basis.libraryVersion ?? LIBRARY_VERSION
      } : { governing: null, applied: [], libraryVersion: LIBRARY_VERSION },
      action: payload.action ?? null,
      reason: payload.reason ?? [],
      evidence: payload.evidence ?? null,
      sources: provenance ?? null,
      snapshots: {
        plan: payload.planSnapshot ?? null,
        preview: payload.previewSnapshot ?? null,
        committedPlan: payload.planSnapshot && payload.tool === "commit_adjust_plan" ? payload.planSnapshot : null
      },
      versions: {
        engine: basis?.engineVersion ?? ENGINE_VERSION,
        ruleLibrary: basis?.libraryVersion ?? LIBRARY_VERSION,
        ...(payload.versions ?? {})
      },
      // Compatibility alias for existing callers; the canonical nodes above
      // are shared by every decision-producing tool.
      decisionBasis: basis,
      provenance
    }
  };
  decisionStore.set(decisionId, record);
  return { decisionId, ...payload };
}

export function attachDecisionCommit(decisionId, commitment) {
  prune();
  const record = decisionStore.get(decisionId);
  if (!record) return null;
  record.trace.commitment = structuredClone(commitment);
  if (commitment.committedPlanSnapshot) {
    record.trace.snapshots.committedPlan = structuredClone(commitment.committedPlanSnapshot);
  }
  record.trace.versions = { ...record.trace.versions, committedPlanVersion: commitment.committedPlanVersion };
  return record;
}

export function explainDecision(decisionId) {
  prune();
  return decisionStore.get(decisionId) || null;
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
  decisionStore.clear();
  outcomes.clear();
}

export function setDecisionRecordStore(adapter) {
  if (!adapter || typeof adapter.get !== "function" || typeof adapter.set !== "function" ||
      typeof adapter.delete !== "function" || typeof adapter.entries !== "function" ||
      typeof adapter.clear !== "function") {
    throw new Error("Decision record store adapter must implement get, set, delete, entries and clear.");
  }
  decisionStore = adapter;
}
