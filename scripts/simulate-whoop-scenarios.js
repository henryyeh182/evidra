// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Walk the WHOOP source-schema scenarios and print what each document shape
 * turns into.
 *
 *   npm run simulate:whoop
 *   npm run simulate:whoop -- --asOf 2026-08-01
 *   npm run simulate:whoop -- --scenario restless_nights --json
 *
 * `restless_nights` is the one to read first: it is the shape where in-bed time
 * and time asleep diverge, which is what the sleep mapping used to get wrong.
 */

import { WHOOP_SCENARIOS } from "../eval/scenarios/whoop.js";
import { runWhoopScenario, DEFAULT_AS_OF } from "../eval/scenarios/whoop.run.js";
import { reportScenarios, parseArgs } from "./lib/report-source-scenarios.js";

const args = parseArgs(process.argv.slice(2), DEFAULT_AS_OF);
await reportScenarios({
  vendor: "WHOOP",
  scenarios: WHOOP_SCENARIOS,
  run: runWhoopScenario,
  args
});
