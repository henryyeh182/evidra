// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Walk the Google Health Takeout source-schema scenarios and print what each
 * export shape turns into.
 *
 *   npm run simulate:google-health
 *   npm run simulate:google-health -- --asOf 2026-08-01
 *   npm run simulate:google-health -- --scenario lossy_export --json
 *
 * The output is a reading report, not a scoreboard: which canonical signals a
 * given Takeout shape yields, which it cannot, and that a decision still lands
 * and explains itself either way. The same runner backs
 * eval/test/googleHealthScenarios.test.js, so what prints here is what is
 * asserted.
 */

import { GOOGLE_HEALTH_SCENARIOS } from "../eval/scenarios/google-health.js";
import { runGoogleHealthScenario, DEFAULT_AS_OF } from "../eval/scenarios/google-health.run.js";

function parseArgs(argv) {
  const args = { asOf: DEFAULT_AS_OF, scenario: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--asOf") args.asOf = argv[++i];
    else if (argv[i] === "--scenario") args.scenario = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const scenarios = args.scenario
  ? GOOGLE_HEALTH_SCENARIOS.filter((scenario) => scenario.id === args.scenario)
  : GOOGLE_HEALTH_SCENARIOS;

if (scenarios.length === 0) {
  console.error(`Unknown scenario: ${args.scenario}`);
  console.error(`Available: ${GOOGLE_HEALTH_SCENARIOS.map((s) => s.id).join(", ")}`);
  process.exit(1);
}

const results = [];
for (const scenario of scenarios) {
  results.push(await runGoogleHealthScenario(scenario, { asOf: args.asOf }));
}

if (args.json) {
  console.log(JSON.stringify({ asOf: args.asOf, results }, null, 2));
} else {
  for (const result of results) {
    const { state, decision, counts } = result;

    console.log(`\n${"=".repeat(76)}`);
    console.log(`${result.id} — ${result.label}`);
    console.log(`${"=".repeat(76)}`);
    console.log(`why          ${result.purpose}`);
    console.log(`export       ${counts.days} days · dialects: ${result.dialects.join(", ")}`);
    console.log(
      `parsed       ${counts.workouts} workouts · ${counts.healthMetrics} metrics · ` +
        `${counts.vendorAssessments} vendor assessments`
    );
    const list = (values) => values.join(", ") || "(none)";
    console.log(`recovery     read:    ${list(state.signalCoverage.recovery.usable)}`);
    console.log(`             missing: ${list(state.signalCoverage.recovery.missing)}`);
    console.log(`training     read:    ${list(state.signalCoverage.training.usable)}`);
    console.log(`             missing: ${list(state.signalCoverage.training.missing)}`);

    const { from, to } = decision.action;
    console.log(
      `decision     ${decision.decision.type} / ${decision.decision.intent} · confidence ${decision.confidence}`
    );
    if (from) {
      console.log(`             from ${from.focus} · ${from.intensity} · ${from.durationMinutes}min`);
      console.log(`             to   ${to.focus} · ${to.intensity} · ${to.durationMinutes}min`);
    }
    decision.reason.forEach((line) => console.log(`             ↳ ${line}`));

    console.log("checks");
    for (const check of result.checks) {
      console.log(`  ${check.passed ? "PASS" : "FAIL"}  ${check.name}`);
      if (!check.passed) console.log(`        ${check.detail}`);
    }
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${"-".repeat(72)}`);
  console.log(`${results.length - failed.length}/${results.length} scenarios passed every check.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((result) => result.id).join(", ")}`);
  }
  console.log("");
}

if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}
