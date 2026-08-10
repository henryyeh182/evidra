// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { runPlanHarness } from "../plan-runner.js";

test("plan decision surface holds across generate, preview and commit", async () => {
  const { scenarios, findings, errors } = await runPlanHarness();

  assert.equal(errors.length, 0, `plan scenarios failed to run: ${errors.map((e) => `${e.scenario}: ${e.message}`).join("; ")}`);
  assert.ok(scenarios.length >= 4, "the plan scenario set should not shrink silently");
  assert.deepEqual(
    findings,
    [],
    `\n${findings.map((finding) => `  ${finding.scenario}: ${finding.failure}`).join("\n")}\n`
  );
});
