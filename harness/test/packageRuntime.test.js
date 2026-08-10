import test from "node:test";
import assert from "node:assert/strict";

import { ENGINE_VERSION } from "../../packages/decision-engine/src/version.js";
import { getRuleLibrary } from "../../packages/rules/src/index.js";
import { loadBaseRulePackage } from "../../packages/rules/src/packageBoundary.js";
import { loadScenarios } from "../lib/chain.js";
import { runHarness } from "../runner.js";

test("Decision Harness runs against the package-loaded Rule Library", async () => {
  const package_ = loadBaseRulePackage({ engineVersion: ENGINE_VERSION });
  const scenarios = await loadScenarios();
  const result = await runHarness(scenarios);
  const packageIds = package_.manifest.rules.map(({ id }) => id);
  const runtimeIds = getRuleLibrary().rules.map(({ ruleId }) => ruleId);

  assert.deepEqual(runtimeIds, packageIds);
  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.scenarios.length, scenarios.length);
});
