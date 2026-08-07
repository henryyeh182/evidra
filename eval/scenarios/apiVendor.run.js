// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The scenario runner shared by the two OAuth-API vendors, Oura and WHOOP.
 *
 * The path under test is the whole one:
 *
 *   API documents → validated against /schemas/sources/<vendor>.api.json
 *                 → Fitness Evidence Model, validated against /schemas/evidence
 *                 → evidra_assess_fitness_state / evidra_decide_session over JSON-RPC
 *                 → the scenario's checks
 *
 * Calls go through the MCP server exactly as a client's would, so a scenario
 * failing here means a real caller would have seen it too. Documents are passed
 * in as tool arguments; nothing is read from disk on the server's behalf, and
 * nothing is fetched from either vendor.
 *
 * The file-based vendors each have their own runner because each has a parsing
 * step of its own — a zip, a CSV pack, an XML stream. These two have none: the
 * caller hands over JSON that is already shaped, so one runner serves both and
 * the difference between them lives entirely in the scenario files.
 *
 * Checks are declarative here rather than closures. Every assertion these
 * scenarios are allowed to make is one of the six named in ./README.md, so the
 * scenarios state which ones apply and this file knows how to run them. That
 * keeps a scenario from quietly growing a check that asserts a threshold.
 */

import { readFile } from "node:fs/promises";

import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";
import { CANONICAL_SIGNALS, VENDOR_SCHEMAS } from "../../packages/evidence/src/index.js";
import { validate } from "../lib/jsonSchema.js";

export const DEFAULT_AS_OF = "2026-07-26";

const evidenceSchema = JSON.parse(
  await readFile(new URL("../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);

async function callTool(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) throw new Error(`${name} failed: ${response.error.message}`);
  return JSON.parse(response.result.content[0].text);
}

function signalsIn(normalized) {
  return new Set([
    ...normalized.healthMetrics.map((metric) => metric.type),
    ...normalized.vendorAssessments.map((item) => item.type)
  ]);
}

/**
 * @param {object} options
 * @param {string} options.vendor          registry key, e.g. "oura"
 * @param {object} options.scenario
 * @param {Function} options.buildDocuments  (scenario, {asOf}) => raw parts
 * @param {Function} options.buildEvidence   (parts, {asOf, sinceDays}) => normalized
 * @param {object} options.rawSchema
 * @param {object} options.context         profile / goals / constraints / scheduledSession
 */
export async function runApiVendorScenario({
  vendor,
  scenario,
  buildDocuments,
  buildEvidence,
  rawSchema,
  context,
  asOf = DEFAULT_AS_OF
}) {
  const userId = `sim_${vendor}_${scenario.id}`;
  const documents = buildDocuments(scenario, { asOf });
  const normalized = buildEvidence(documents, { asOf, sinceDays: 90 });

  const evidence = {
    profile: context.profile,
    goals: context.goals,
    constraints: context.constraints,
    ...normalized
  };

  const checks = [];
  const add = (name, passed, detail = null) => checks.push({ name, passed, detail });

  const rawValidation = validate(documents, rawSchema);
  add(
    `documents are legal against the ${vendor} source schema`,
    rawValidation.valid,
    rawValidation.valid ? null : rawValidation.errors.slice(0, 3).join(" | ")
  );

  const evidenceValidation = validate(evidence, evidenceSchema);
  add(
    "normalized evidence matches the Fitness Evidence Model",
    evidenceValidation.valid,
    evidenceValidation.valid ? null : evidenceValidation.errors.slice(0, 3).join(" | ")
  );

  const state = await callTool("evidra_assess_fitness_state", { userId, date: asOf, evidence });
  const decision = await callTool("evidra_decide_session", {
    userId,
    date: asOf,
    evidence,
    scheduledSession: context.scheduledSession,
    availableMinutes: context.constraints?.availableMinutes
  });

  // 1. Naming — everything emitted is canonical and labelled with this vendor.
  const stray = [...normalized.healthMetrics, ...normalized.vendorAssessments].filter(
    (event) => !CANONICAL_SIGNALS[event.type] || event.source !== vendor
  );
  add(
    "every emitted signal is canonical and carries this vendor's source label",
    stray.length === 0,
    stray.slice(0, 3).map((event) => `${event.type}/${event.source}`).join(", ")
  );

  // 3. Registry ↔ parser agreement, on the shape that supplies everything.
  const produced = signalsIn(normalized);
  if (scenario.expectSignals) {
    const missing = scenario.expectSignals.filter((signal) => !produced.has(signal));
    add("the signals this document shape can supply all arrive", missing.length === 0, missing.join(", "));
  }
  if (scenario.id === "complete_documents") {
    const declared = [...new Set(VENDOR_SCHEMAS[vendor].signals.map((mapping) => mapping.to))];
    const undelivered = declared.filter((signal) => !produced.has(signal));
    add(
      "every signal the registry declares is produced by a complete set of documents",
      undelivered.length === 0,
      undelivered.join(", ")
    );
  }

  // 4. Sentinels and gates — what must not become a reading.
  if (scenario.expectAbsent) {
    const leaked = scenario.expectAbsent.filter((signal) => produced.has(signal));
    add("signals this shape cannot support are absent, not invented", leaked.length === 0, leaked.join(", "));
  }
  if (scenario.expectNoZeroReadings) {
    const zeros = [...normalized.healthMetrics, ...normalized.vendorAssessments].filter(
      (event) => event.value === 0
    );
    add("an unscored record never becomes a zero reading", zeros.length === 0, zeros.slice(0, 3).map((z) => z.type).join(", "));
  }
  if (scenario.expectOneSleepReadingPerDay) {
    const perDay = new Map();
    for (const metric of normalized.healthMetrics.filter((m) => m.type === "sleep_duration_hours")) {
      const day = metric.recordedAt.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    const doubled = [...perDay.entries()].filter(([, count]) => count > 1);
    add("only one sleep reading per day survives", doubled.length === 0, doubled.slice(0, 3).map(([d, c]) => `${d}×${c}`).join(", "));
  }

  // 2. Units — asserted where the scenario is built around one.
  if (scenario.expectSleepHoursBelow !== undefined) {
    const overstated = normalized.healthMetrics.filter(
      (metric) => metric.type === "sleep_duration_hours" && metric.value >= scenario.expectSleepHoursBelow
    );
    add(
      `sleep duration is time asleep, not time in bed (< ${scenario.expectSleepHoursBelow}h)`,
      overstated.length === 0,
      overstated.slice(0, 2).map((m) => `${m.recordedAt.slice(0, 10)}=${m.value}h`).join(", ")
    );
  }

  // 5. Honesty — what is missing is reported missing.
  if (scenario.expectRecovery) {
    const usable = new Set(state.signalCoverage.recovery.usable);
    const absent = scenario.expectRecovery.filter((signal) => !usable.has(signal));
    add("recovery coverage names what was actually read", absent.length === 0, absent.join(", "));
  }
  if (scenario.expectTrainingMissing) {
    add(
      "sessions without a load are reported through training coverage",
      state.signalCoverage.training.missing.includes("trainingLoad"),
      `training.missing = [${state.signalCoverage.training.missing.join(", ")}]`
    );
  }

  // 6. A decision still lands, and explains itself. Never what the decision is.
  add(
    "a decision comes back with a type, a reason and a confidence",
    Boolean(decision.decision?.type) && Array.isArray(decision.reason) && decision.reason.length > 0 && decision.confidence !== undefined,
    `type=${decision.decision?.type} reasons=${decision.reason?.length} confidence=${decision.confidence}`
  );

  return {
    id: scenario.id,
    label: scenario.label,
    purpose: scenario.purpose,
    asOf,
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
