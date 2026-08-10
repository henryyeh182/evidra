// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Stable regression surface for a package release.
 *
 * This intentionally compares structured decision behavior, not rule prose or
 * evidence citations. A provenance correction must not look like a decision
 * regression; a changed verdict, action, confidence, limit, governing rule,
 * or graph edge must.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validate } from "../../eval/lib/jsonSchema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const schemaPath = join(root, "harness/schemas/regression-baseline.schema.json");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function actionSurface(action) {
  return {
    from: action?.from ?? null,
    to: action?.to ?? null,
    changed: action?.changed ?? []
  };
}

function basisSurface(basis) {
  return {
    policies: clone(basis?.policies ?? null),
    governingRule: basis?.governingRule
      ? {
          ruleId: basis.governingRule.ruleId,
          category: basis.governingRule.category,
          basis: basis.governingRule.basis,
          evidence: clone(basis.governingRule.evidence),
          evidenceLevel: basis.governingRule.evidenceLevel,
          measured: clone(basis.governingRule.measured),
          thresholds: clone(basis.governingRule.thresholds)
        }
      : null,
    appliedRules: (basis?.appliedRules || []).map((rule) => ({
      ruleId: rule.ruleId,
      category: rule.category,
      basis: rule.basis,
      evidence: clone(rule.evidence),
      evidenceLevel: rule.evidenceLevel,
      measured: clone(rule.measured),
      applied: rule.applied,
      governing: rule.governing
    })),
    limits: clone(basis?.limits ?? null)
  };
}

export function decisionSurface(run) {
  const decision = run.decision;
  return {
    decision: clone(decision.decision),
    action: actionSurface(decision.action),
    reason: clone(decision.reason || []),
    evidence: clone(decision.evidence || []),
    confidence: decision.confidence ?? null,
    signalCoverage: clone(decision.signalCoverage ?? null),
    limits: clone(decision.limits || []),
    decisionBasis: basisSurface(decision.decisionBasis)
  };
}

function node(id, type, value, extra = {}) {
  return { id, type, value, ...extra };
}

export function decisionGraph(run) {
  const surface = decisionSurface(run);
  const nodes = [];
  const edges = [];
  for (const evidence of surface.evidence) {
    const id = `evidence:${evidence.signal}`;
    nodes.push(node(id, "evidence", { value: evidence.value, recordedAt: evidence.recordedAt }, { source: "decision.evidence" }));
  }
  for (const rule of surface.decisionBasis.appliedRules) {
    const id = `rule:${rule.ruleId}`;
    nodes.push(node(id, "rule", {
      ruleId: rule.ruleId,
      applied: rule.applied,
      governing: rule.governing,
      measured: rule.measured,
      evidence: rule.evidence,
      evidenceLevel: rule.evidenceLevel
    }, { source: "decisionBasis.appliedRules", ruleId: rule.ruleId }));
    for (const evidence of surface.evidence) {
      edges.push({ from: `evidence:${evidence.signal}`, to: id, reason: "considered_by_rule" });
    }
  }
  nodes.push(node("decision", "decision", surface.decision, { source: "decision" }));
  nodes.push(node("action", "action", surface.action, { source: "action" }));
  for (const rule of surface.decisionBasis.appliedRules) {
    edges.push({
      from: `rule:${rule.ruleId}`,
      to: "decision",
      reason: rule.governing ? "governs" : "applied_but_overruled"
    });
  }
  edges.push({ from: "decision", to: "action", reason: "produces" });
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { nodes, edges };
}

export function regressionCase(run) {
  const surface = decisionSurface(run.result);
  return {
    id: run.scenario.id,
    source: run.scenario.rulePosition?.length ? "harness_boundary_or_golden" : "harness",
    decision: surface,
    graph: decisionGraph(run.result)
  };
}

export function buildRegressionBaseline(harnessResult) {
  return {
    schemaVersion: "1.0.0",
    corpus: {
      id: "pacevera-harness-v1",
      description: "Decision Harness scenarios, including golden verdict pins and threshold boundary cases.",
      source: "harness/scenarios",
      groundTruth: "behavioral_regression_baseline"
    },
    cases: harnessResult.scenarios.map(regressionCase)
  };
}

function indexCases(cases) {
  return new Map((cases || []).map((item) => [item.id, item]));
}

export function compareRegression(baseline, actual) {
  const before = indexCases(baseline.cases);
  const after = indexCases(actual.cases);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const decisionDiffs = [];
  const graphDiffs = [];
  const added = [];
  const removed = [];
  for (const id of ids) {
    const oldCase = before.get(id);
    const newCase = after.get(id);
    if (!oldCase) { added.push(id); continue; }
    if (!newCase) { removed.push(id); continue; }
    if (JSON.stringify(oldCase.decision) !== JSON.stringify(newCase.decision)) {
      decisionDiffs.push({ id, before: oldCase.decision, after: newCase.decision });
    }
    if (JSON.stringify(oldCase.graph) !== JSON.stringify(newCase.graph)) {
      graphDiffs.push({ id, before: oldCase.graph, after: newCase.graph });
    }
  }
  return { added, removed, decisionDiffs, graphDiffs };
}

export async function readRegressionSchema() {
  return JSON.parse(await readFile(schemaPath, "utf8"));
}

export async function validateRegressionBaseline(baseline) {
  const schema = await readRegressionSchema();
  const result = validate(baseline, schema);
  if (!result.valid) throw new Error(`regression baseline schema invalid:\n${result.errors.join("\n")}`);
  const ids = baseline.cases.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("regression baseline contains duplicate case ids");
  return baseline;
}
