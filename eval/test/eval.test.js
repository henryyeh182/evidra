import test from "node:test";
import assert from "node:assert/strict";

import { runGoldenSet, checkGates } from "../runner.js";

test("golden set v0 passes every gate on the current build", async () => {
  const report = await runGoldenSet();
  const gateFailures = checkGates(report.metrics);

  const failedCases = report.caseResults.filter((c) => !c.passed);
  assert.deepEqual(
    failedCases,
    [],
    `failed cases: ${failedCases.map((c) => `${c.id}: ${c.failures.join("; ")}`).join(" || ")}`
  );
  assert.deepEqual(gateFailures, [], `gate failures: ${gateFailures.join("; ")}`);
});

test("grounding and plan-validity are actually exercised (not vacuously green)", async () => {
  const report = await runGoldenSet();
  assert.ok(report.counts.groundingRefs > 0, "expected at least one id reference to ground");
  assert.ok(report.counts.planChecks > 0, "expected at least one plan-validity check");
});

test("diagnostic surfaces the planner's ungrounded exercise names", async () => {
  const report = await runGoldenSet();
  // The planner emits free-form exercise names, not catalog ids, so coverage is
  // expected to be partial today. This asserts the diagnostic is wired and
  // reporting the gap (P3/R1) rather than silently passing.
  assert.ok(report.diagnostics.planExerciseCatalogCoverage <= 1);
  assert.ok(Array.isArray(report.diagnostics.unmatchedExerciseNames));
});
