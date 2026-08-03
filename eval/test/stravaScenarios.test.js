import test from "node:test";
import assert from "node:assert/strict";

import { STRAVA_SCENARIOS, ACTIVITIES_HEADER } from "../scenarios/strava.js";
import { runStravaScenarios, DEFAULT_AS_OF } from "../scenarios/strava.run.js";

// Each scenario is a shape of Strava bulk export, and its checks are
// schema-reading invariants — positional reading, canonical types, units,
// source labels, empty-is-not-zero, the offset the CSV cannot supply, and
// coverage honesty. They assert nothing about what a given readiness score
// ought to be: simulated physiology is not ground truth.
const results = await runStravaScenarios({ asOf: DEFAULT_AS_OF });

for (const scenario of STRAVA_SCENARIOS) {
  test(`strava export schema scenario: ${scenario.id}`, () => {
    const result = results.find((candidate) => candidate.id === scenario.id);
    assert.ok(result, `${scenario.id} did not run`);

    assert.deepEqual(
      result.failures.map((failure) => `${failure.name} — ${failure.detail}`),
      [],
      `${scenario.label}: ${result.failures.length} check(s) failed`
    );
    assert.ok(result.checks > 0, "a scenario with no checks proves nothing");
  });
}

test("a scenario exists for every export shape the connector must survive", () => {
  const ids = new Set(STRAVA_SCENARIOS.map((scenario) => scenario.id));
  for (const required of [
    "complete_export",
    "no_power_sessions",
    "timezone_unknown",
    "column_shift",
    "age_estimated_max_hr",
    "strava_only_athlete"
  ]) {
    assert.ok(ids.has(required), `no scenario covers ${required}`);
  }
});

test("the scenarios are built on the real 103-column header, duplicates included", () => {
  // Reading by name is the failure this layout forces the parser to avoid, so a
  // scenario built on a de-duplicated header would prove nothing.
  assert.equal(ACTIVITIES_HEADER.length, 103);
  for (const [name, positions] of [
    ["Elapsed Time", [5, 15]],
    ["Distance", [6, 17]],
    ["Max Heart Rate", [7, 30]],
    ["Relative Effort", [8, 37]],
    ["Commute", [9, 50]]
  ]) {
    const found = ACTIVITIES_HEADER.map((header, index) => (header === name ? index : -1)).filter(
      (index) => index >= 0
    );
    assert.deepEqual(found, positions, `${name} is not where the column map expects it`);
  }
});

test("at least one scenario expects the parser to refuse a file", () => {
  // Without this, a parser that stopped asserting its header would still pass
  // every other scenario, because they all present a correct layout.
  const refusing = STRAVA_SCENARIOS.filter((scenario) => scenario.expectParseError);
  assert.ok(refusing.length > 0, "nothing exercises the header assertion");
});
