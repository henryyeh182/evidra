// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

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

test("every movement a plan prescribes resolves in the catalog", async () => {
  const report = await runGoldenSet();
  // Was a partial-by-design diagnostic while the planner emitted free-form
  // names. Sessions now carry canonical ids, so this is a reference check and
  // anything unresolved is a plan prescribing work nothing can describe.
  assert.equal(report.metrics.planExerciseCatalogCoverage, 1);
  assert.deepEqual(report.diagnostics.unmatchedExerciseNames, []);
  assert.ok(report.counts.exerciseNamesChecked > 0, "expected the check to actually run");
});
