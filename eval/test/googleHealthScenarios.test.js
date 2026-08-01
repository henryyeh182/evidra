import test from "node:test";
import assert from "node:assert/strict";

import {
  GOOGLE_HEALTH_SCENARIOS,
  GOOGLE_HEALTH_DIALECTS,
  buildGoogleHealthTakeout
} from "../scenarios/google-health.js";
import { runGoogleHealthScenario, DEFAULT_AS_OF } from "../scenarios/google-health.run.js";

// Each scenario is a shape of Google Health Takeout export, and its checks are
// schema-reading invariants — naming, units, source labels, sentinels,
// coverage honesty. They deliberately assert nothing about what a given
// readiness score ought to be: simulated physiology is not ground truth.
for (const scenario of GOOGLE_HEALTH_SCENARIOS) {
  test(`google health schema scenario: ${scenario.id}`, async () => {
    const result = await runGoogleHealthScenario(scenario, { asOf: DEFAULT_AS_OF });
    const failures = result.checks.filter((check) => !check.passed);

    assert.deepEqual(
      failures.map((check) => `${check.name} — ${check.detail}`),
      [],
      `${scenario.label}: ${failures.length} check(s) failed`
    );
    assert.ok(result.checks.length > 0, "a scenario with no checks proves nothing");
  });
}

test("scenarios cover every dialect the renderer can produce", () => {
  const used = new Set();
  for (const scenario of GOOGLE_HEALTH_SCENARIOS) {
    for (const dialect of scenario.dialects || [scenario.dialect || "csv"]) used.add(dialect);
  }

  assert.deepEqual(
    GOOGLE_HEALTH_DIALECTS.filter((dialect) => !used.has(dialect)),
    [],
    "a dialect the renderer supports but no scenario exercises is an untested reading path"
  );
});

test("the simulation is deterministic — same shape, same evidence, every run", () => {
  const [scenario] = GOOGLE_HEALTH_SCENARIOS;
  const first = buildGoogleHealthTakeout(scenario, { asOf: DEFAULT_AS_OF });
  const second = buildGoogleHealthTakeout(scenario, { asOf: DEFAULT_AS_OF });

  assert.deepEqual(second, first);
});
