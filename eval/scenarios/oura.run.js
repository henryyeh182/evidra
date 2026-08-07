// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFile } from "node:fs/promises";

import { buildOuraEvidence } from "../../packages/connectors/src/index.js";
import {
  OURA_SCENARIOS,
  buildOuraDocuments,
  PROFILE,
  GOALS,
  CONSTRAINTS,
  SCHEDULED_SESSION
} from "./oura.js";
import { runApiVendorScenario, DEFAULT_AS_OF } from "./apiVendor.run.js";

const rawSchema = JSON.parse(
  await readFile(new URL("../../schemas/sources/oura.api.json", import.meta.url), "utf8")
);

const CONTEXT = {
  profile: PROFILE,
  goals: GOALS,
  constraints: CONSTRAINTS,
  scheduledSession: SCHEDULED_SESSION
};

export async function runOuraScenario(scenario, { asOf = DEFAULT_AS_OF } = {}) {
  return runApiVendorScenario({
    vendor: "oura",
    scenario,
    buildDocuments: buildOuraDocuments,
    buildEvidence: buildOuraEvidence,
    rawSchema,
    context: CONTEXT,
    asOf
  });
}

export async function runOuraScenarios({ asOf = DEFAULT_AS_OF } = {}) {
  const results = [];
  for (const scenario of OURA_SCENARIOS) {
    results.push(await runOuraScenario(scenario, { asOf }));
  }
  return { asOf, passed: results.every((result) => result.passed), results };
}

export { DEFAULT_AS_OF };
