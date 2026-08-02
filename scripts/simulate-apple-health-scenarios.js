/**
 * Walk the Apple Health source-schema scenarios and print what each export
 * shape turns into.
 *
 *   npm run simulate:apple-health
 *   npm run simulate:apple-health -- --asOf 2026-08-01
 *   npm run simulate:apple-health -- --scenario sparse_wear --json
 *
 * The output is a reading report, not a scoreboard: which canonical signals a
 * given export shape yields, which it cannot, and that a decision still lands
 * and explains itself either way. The same runner backs the scenario test, so
 * what prints here is what is asserted.
 */

import { APPLE_HEALTH_SCENARIOS } from "../eval/scenarios/apple-health.js";
import { runAppleHealthScenarios, DEFAULT_AS_OF } from "../eval/scenarios/apple-health.run.js";

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

if (args.scenario && !APPLE_HEALTH_SCENARIOS.some((scenario) => scenario.id === args.scenario)) {
  console.error(`Unknown scenario: ${args.scenario}`);
  console.error(`Available: ${APPLE_HEALTH_SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
  process.exit(1);
}

const all = await runAppleHealthScenarios({ asOf: args.asOf });
const results = args.scenario ? all.filter((result) => result.id === args.scenario) : all;

if (args.json) {
  console.log(JSON.stringify({ asOf: args.asOf, results }, null, 2));
} else {
  const list = (values) => (values && values.length ? values.join(", ") : "(none)");

  for (const result of results) {
    const { state, decision, counts } = result;

    console.log(`\n${"=".repeat(76)}`);
    console.log(`${result.id} — ${result.label}`);
    console.log(`${"=".repeat(76)}`);
    console.log(`why          ${result.purpose}`);
    console.log(`export       ${counts.records} records · ${counts.workouts} workouts`);
    console.log(`parsed       ${counts.events} normalized events`);
    console.log(`recovery     read:    ${list(state.signalCoverage?.recovery?.usable)}`);
    console.log(`             missing: ${list(state.signalCoverage?.recovery?.missing)}`);
    console.log(`training     read:    ${list(state.signalCoverage?.training?.usable)}`);
    console.log(`             missing: ${list(state.signalCoverage?.training?.missing)}`);

    const { from, to } = decision.action ?? {};
    console.log(`decision     ${decision.decision?.type} / ${decision.decision?.intent} · confidence ${decision.confidence}`);
    if (from) {
      console.log(`             from ${from.focus} · ${from.intensity} · ${from.durationMinutes}min`);
      console.log(`             to   ${to.focus} · ${to.intensity} · ${to.durationMinutes}min`);
    }
    (decision.reason ?? []).forEach((line) => console.log(`             ↳ ${line}`));

    console.log(`checks       ${result.checks} declared`);
    if (result.failures.length === 0) {
      console.log("             all passed");
    } else {
      for (const failure of result.failures) {
        console.log(`  FAIL  ${failure.name}`);
        console.log(`        ${failure.detail}`);
      }
    }
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${"-".repeat(72)}`);
  console.log(`${results.length - failed.length}/${results.length} scenarios passed every check.`);
  if (failed.length > 0) console.log(`Failed: ${failed.map((result) => result.id).join(", ")}`);
  console.log("");
}

if (results.some((result) => !result.passed)) process.exitCode = 1;
