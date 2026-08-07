// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Walk the Oura source-schema scenarios and print what each document shape
 * turns into.
 *
 *   npm run simulate:oura
 *   npm run simulate:oura -- --asOf 2026-08-01
 *   npm run simulate:oura -- --scenario scorecard_only --json
 *
 * A reading report, not a scoreboard: which canonical signals a given shape
 * yields, which it cannot, and that a decision still lands and explains itself
 * either way.
 */

import { OURA_SCENARIOS } from "../eval/scenarios/oura.js";
import { runOuraScenario, DEFAULT_AS_OF } from "../eval/scenarios/oura.run.js";
import { reportScenarios, parseArgs } from "./lib/report-source-scenarios.js";

const args = parseArgs(process.argv.slice(2), DEFAULT_AS_OF);
await reportScenarios({
  vendor: "Oura",
  scenarios: OURA_SCENARIOS,
  run: runOuraScenario,
  args
});
