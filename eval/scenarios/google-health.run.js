// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Run the Google Health Takeout source-schema scenarios end to end.
 *
 * Same path under test as ./run.js runs for Garmin, with one extra hop because
 * this dialect arrives as files rather than one JSON document:
 *
 *   file bundle → parseGoogleHealthExport
 *               → validated against /schemas/sources/google-health.export.json
 *               → Fitness Evidence Model, validated against /schemas/evidence
 *               → evidra_assess_fitness_state / evidra_decide_session over JSON-RPC
 *               → the scenario's schema checks
 *
 * Calls go through the MCP server exactly as a client's would. What is
 * measured is comprehension of the source schema — naming, units, source
 * labels, sentinels, coverage honesty — never a threshold.
 */

import { readFile } from "node:fs/promises";

import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";
import { parseGoogleHealthExport, buildGoogleHealthEvidence } from "../../packages/connectors/src/index.js";
import { CANONICAL_SIGNALS, describeSourceCoverage, VENDOR_SCHEMAS } from "../../packages/evidence/src/index.js";
import { validate } from "../lib/jsonSchema.js";
import { GOOGLE_HEALTH_SCENARIOS, buildGoogleHealthTakeout } from "./google-health.js";

export const DEFAULT_AS_OF = "2026-07-26";

const rawSchema = JSON.parse(
  await readFile(new URL("../../schemas/sources/google-health.export.json", import.meta.url), "utf8")
);
const evidenceSchema = JSON.parse(
  await readFile(new URL("../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);

/** What the registry promises a Takeout export can contain. */
const DECLARED_GOOGLE_HEALTH_SIGNALS = [
  ...new Set(VENDOR_SCHEMAS.google_health_export.signals.map((mapping) => mapping.to))
].sort();

async function callTool(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) {
    throw new Error(`${name} failed: ${response.error.message}`);
  }
  return JSON.parse(response.result.content[0].text);
}

/** Canonical evidence as comparable tuples — the identity a translation must preserve. */
function canonicalFingerprint(normalized) {
  const day = (iso) => String(iso).slice(0, 10);
  const signals = [
    ...normalized.healthMetrics.map((m) => `metric:${m.type}:${m.value}:${m.unit}:${m.source}:${day(m.recordedAt)}`),
    ...normalized.vendorAssessments.map(
      (a) => `composite:${a.type}:${a.value}:${a.unit}:${a.source}:${day(a.recordedAt)}`
    ),
    ...normalized.workouts.map(
      (w) => `workout:${w.type}:${w.durationMinutes}:${w.trainingLoad}:${w.source}:${day(w.startedAt)}`
    )
  ];
  return signals.sort();
}

function normalizeFor(scenario, { asOf, dialect }) {
  const files = buildGoogleHealthTakeout(scenario, { asOf, dialect });
  const rawExport = parseGoogleHealthExport(files);
  return { files, rawExport, normalized: buildGoogleHealthEvidence(rawExport, { asOf, sinceDays: 90 }) };
}

/** One scenario: render, parse, normalize, decide, check. */
export async function runGoogleHealthScenario(scenario, { asOf = DEFAULT_AS_OF } = {}) {
  const userId = `sim_gh_${scenario.id}`;
  const dialects = scenario.dialects || [scenario.dialect || "csv"];

  const renderings = dialects.map((dialect) => ({ dialect, ...normalizeFor(scenario, { asOf, dialect }) }));
  const [primary] = renderings;
  const { rawExport, normalized } = primary;

  const rawValidation = validate(rawExport, rawSchema);
  const evidence = {
    profile: scenario.profile,
    goals: scenario.goals,
    constraints: scenario.constraints,
    ...normalized
  };
  const evidenceValidation = validate(evidence, evidenceSchema);

  const state = await callTool("evidra_assess_fitness_state", { userId, date: asOf, evidence });
  const decision = await callTool("evidra_decide_session", {
    userId,
    date: asOf,
    evidence,
    scheduledSession: scenario.scheduledSession,
    availableMinutes: scenario.constraints?.availableMinutes
  });

  const checks = scenario.checks.map((check) => {
    let outcome;
    try {
      outcome = check.run({
        state,
        decision,
        evidence,
        rawExport,
        asOf,
        canonicalSignals: CANONICAL_SIGNALS,
        declaredSignals: DECLARED_GOOGLE_HEALTH_SIGNALS,
        coverage: describeSourceCoverage(["google_health_export"])
      });
    } catch (error) {
      outcome = `threw: ${error.message}`;
    }
    return { name: check.name, passed: outcome === true, detail: outcome === true ? null : String(outcome) };
  });

  // Every dialect is a different spelling of the same facts. If the layer is a
  // translation rather than a pile of per-format special cases, they must land
  // on identical canonical evidence — and each must be legal by the contract.
  for (const rendering of renderings.slice(1)) {
    const fingerprint = canonicalFingerprint(rendering.normalized);
    const reference = canonicalFingerprint(normalized);
    const differing = fingerprint.filter((entry, index) => entry !== reference[index]);
    checks.push({
      name: `the "${rendering.dialect}" spelling normalizes identically to "${primary.dialect}"`,
      passed: fingerprint.length === reference.length && differing.length === 0,
      detail:
        fingerprint.length !== reference.length
          ? `${primary.dialect} produced ${reference.length} signals, ${rendering.dialect} produced ${fingerprint.length}`
          : differing.slice(0, 2).join(" vs ") || null
    });

    const dialectValidation = validate(rendering.rawExport, rawSchema);
    if (!dialectValidation.valid) {
      checks.push({
        name: `the "${rendering.dialect}" export is legal against the Google Health source schema`,
        passed: false,
        detail: dialectValidation.errors.slice(0, 3).join(" | ")
      });
    }
  }

  if (!rawValidation.valid) {
    checks.unshift({
      name: "parsed export matches the Google Health source schema",
      passed: false,
      detail: rawValidation.errors.slice(0, 3).join(" | ")
    });
  }
  if (!evidenceValidation.valid) {
    checks.unshift({
      name: "normalized evidence matches the Fitness Evidence Model",
      passed: false,
      detail: evidenceValidation.errors.slice(0, 3).join(" | ")
    });
  }

  return {
    id: scenario.id,
    label: scenario.label,
    purpose: scenario.purpose,
    asOf,
    dialects,
    passed: checks.every((check) => check.passed),
    checks,
    counts: {
      days: scenario.days,
      workouts: normalized.workouts.length,
      healthMetrics: normalized.healthMetrics.length,
      vendorAssessments: normalized.vendorAssessments.length
    },
    state,
    decision
  };
}

export async function runGoogleHealthScenarios({ asOf = DEFAULT_AS_OF } = {}) {
  const results = [];
  for (const scenario of GOOGLE_HEALTH_SCENARIOS) {
    results.push(await runGoogleHealthScenario(scenario, { asOf }));
  }
  return {
    asOf,
    passed: results.every((result) => result.passed),
    results
  };
}
