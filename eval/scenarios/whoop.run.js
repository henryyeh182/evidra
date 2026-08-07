// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFile } from "node:fs/promises";

import { buildWhoopEvidence } from "../../packages/connectors/src/index.js";
import {
  WHOOP_SCENARIOS,
  buildWhoopDocuments,
  PROFILE,
  GOALS,
  CONSTRAINTS,
  SCHEDULED_SESSION
} from "./whoop.js";
import { runApiVendorScenario, DEFAULT_AS_OF } from "./apiVendor.run.js";

const rawSchema = JSON.parse(
  await readFile(new URL("../../schemas/sources/whoop.api.json", import.meta.url), "utf8")
);

const CONTEXT = {
  profile: PROFILE,
  goals: GOALS,
  constraints: CONSTRAINTS,
  scheduledSession: SCHEDULED_SESSION
};

export async function runWhoopScenario(scenario, { asOf = DEFAULT_AS_OF } = {}) {
  return runApiVendorScenario({
    vendor: "whoop",
    scenario,
    buildDocuments: buildWhoopDocuments,
    buildEvidence: buildWhoopEvidence,
    rawSchema,
    context: CONTEXT,
    asOf
  });
}

export async function runWhoopScenarios({ asOf = DEFAULT_AS_OF } = {}) {
  const results = [];
  for (const scenario of WHOOP_SCENARIOS) {
    results.push(await runWhoopScenario(scenario, { asOf }));
  }
  return { asOf, passed: results.every((result) => result.passed), results };
}

export { DEFAULT_AS_OF };
