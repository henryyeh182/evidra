// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Printing shared by the source-schema scenario runners.
 *
 * The file-based vendors each grew their own copy of this loop, and the two
 * API vendors do not need a third and fourth. What differs between vendors is
 * how documents are built and checked, which lives in the scenarios; how the
 * result is read aloud is the same everywhere.
 */

export function parseArgs(argv, defaultAsOf) {
  const args = { asOf: defaultAsOf, scenario: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--asOf") args.asOf = argv[++i];
    else if (argv[i] === "--scenario") args.scenario = argv[++i];
    else if (argv[i] === "--json") args.json = true;
  }
  return args;
}

export async function reportScenarios({ vendor, scenarios, run, args }) {
  const selected = args.scenario ? scenarios.filter((item) => item.id === args.scenario) : scenarios;

  if (selected.length === 0) {
    console.error(`Unknown scenario: ${args.scenario}`);
    console.error(`Available: ${scenarios.map((item) => item.id).join(", ")}`);
    process.exit(1);
  }

  const results = [];
  for (const scenario of selected) {
    results.push(await run(scenario, { asOf: args.asOf }));
  }

  if (args.json) {
    console.log(JSON.stringify({ vendor, asOf: args.asOf, results }, null, 2));
  } else {
    for (const result of results) {
      const { state, decision, counts } = result;
      const list = (values) => values.join(", ") || "(none)";

      console.log(`\n${"=".repeat(76)}`);
      console.log(`${result.id} — ${result.label}`);
      console.log(`${"=".repeat(76)}`);
      console.log(`why          ${result.purpose}`);
      console.log(`documents    ${counts.days} days`);
      console.log(
        `parsed       ${counts.workouts} workouts · ${counts.healthMetrics} metrics · ` +
          `${counts.vendorAssessments} vendor assessments`
      );
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
    console.log(`${results.length - failed.length}/${results.length} ${vendor} scenarios passed every check.`);
    if (failed.length > 0) console.log(`Failed: ${failed.map((result) => result.id).join(", ")}`);
    console.log("");
  }

  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
