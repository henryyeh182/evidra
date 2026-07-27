import test from "node:test";
import assert from "node:assert/strict";

import { GARMIN_SCENARIOS, buildGarminExport, GARMIN_DIALECTS } from "../scenarios/garmin.js";
import { runGarminScenario, DEFAULT_AS_OF } from "../scenarios/run.js";

// Each scenario is a shape of Garmin export, and its checks are schema-reading
// invariants — naming, units, source labels, sentinels, coverage honesty. They
// deliberately assert nothing about what a given readiness score ought to be:
// simulated physiology is not ground truth and must never be fitted to.
for (const scenario of GARMIN_SCENARIOS) {
  test(`garmin schema scenario: ${scenario.id}`, async () => {
    const result = await runGarminScenario(scenario, { asOf: DEFAULT_AS_OF });
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
  for (const scenario of GARMIN_SCENARIOS) {
    for (const dialect of scenario.dialects || [scenario.dialect || "modern"]) used.add(dialect);
  }

  assert.deepEqual(
    GARMIN_DIALECTS.filter((dialect) => !used.has(dialect)),
    [],
    "a dialect the renderer supports but no scenario exercises is an untested reading path"
  );
});

test("the simulation is deterministic — same shape, same evidence, every run", () => {
  const [scenario] = GARMIN_SCENARIOS;
  const first = buildGarminExport(scenario, { asOf: DEFAULT_AS_OF });
  const second = buildGarminExport(scenario, { asOf: DEFAULT_AS_OF });

  assert.deepEqual(second, first);
});
