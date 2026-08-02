import test from "node:test";
import assert from "node:assert/strict";

import { APPLE_HEALTH_SCENARIOS } from "../scenarios/apple-health.js";
import { runAppleHealthScenarios, DEFAULT_AS_OF } from "../scenarios/apple-health.run.js";

// Each scenario is a shape of Apple Health export, and its checks are
// schema-reading invariants — naming, units, source labels, sentinels, coverage
// honesty. They assert nothing about what a given readiness score ought to be:
// simulated physiology is not ground truth.
//
// Run as a set rather than one at a time, because dialect equivalence is a
// claim about two scenarios at once.
const results = await runAppleHealthScenarios({ asOf: DEFAULT_AS_OF });

for (const scenario of APPLE_HEALTH_SCENARIOS) {
  test(`apple health schema scenario: ${scenario.id}`, () => {
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

test("the two dialects of a complete export are actually compared", () => {
  const equivalences = APPLE_HEALTH_SCENARIOS.filter((scenario) => scenario.equivalentTo);
  assert.ok(
    equivalences.length > 0,
    "nothing claims dialect equivalence, so reading only the <Workout> tag would pass again"
  );
  for (const scenario of equivalences) {
    assert.ok(
      APPLE_HEALTH_SCENARIOS.some((candidate) => candidate.id === scenario.equivalentTo),
      `${scenario.id} compares against ${scenario.equivalentTo}, which does not exist`
    );
  }
});

test("a scenario exists for every export shape the connector must survive", () => {
  const ids = new Set(APPLE_HEALTH_SCENARIOS.map((scenario) => scenario.id));
  for (const required of [
    "complete_export",
    "legacy_dialect",
    "sentinels_and_gaps",
    "multi_recorder_steps",
    "sparse_wear"
  ]) {
    assert.ok(ids.has(required), `no scenario covers ${required}`);
  }
});
