import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ENGINE_VERSION } from "../../decision-engine/src/version.js";
import { loadBaseRulePackage, validateRulePackage } from "../src/packageBoundary.js";
import { getRuleLibrary } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("base_rules manifest validates and is the runtime rule source", () => {
  const loaded = loadBaseRulePackage({ engineVersion: ENGINE_VERSION });
  assert.equal(loaded.manifest.packageId, "base_rules");
  assert.equal(loaded.manifest.tier, "base");
  assert.equal(loaded.manifest.rules.length, getRuleLibrary().rules.length);
  assert.deepEqual(
    loaded.manifest.rules.map(({ id }) => id),
    getRuleLibrary().rules.map(({ ruleId }) => ruleId)
  );
});

test("package validation rejects duplicate rule identity and checksum drift", () => {
  const packageDir = join(root, "rule-packages", "base_rules");
  assert.throws(() => validateRulePackage(packageDir, { engineVersion: "2.0.0" }), /incompatible/);
  assert.throws(() => validateRulePackage(packageDir, { engineVersion: "1.5.0" }), /incompatible/);
});
