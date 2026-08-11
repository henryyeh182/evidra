import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRulePackage } from "../src/packageBoundary.js";
import { ENGINE_VERSION } from "../../decision-engine/src/version.js";
import { loadBaseRulePackage } from "../src/packageBoundary.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("single_workout_rules remains a stable draft package", () => {
  const loaded = validateRulePackage(join(root, "rule-packages", "single_workout_rules"), { engineVersion: ENGINE_VERSION });
  assert.equal(loaded.manifest.status, "draft");
  assert.deepEqual(loaded.manifest.rules.map(({ id }) => id), ["EVD-R-013", "EVD-R-014", "EVD-R-015"]);
  assert.match(loaded.manifest.contentChecksum, /^sha256:[0-9a-f]{64}$/);
  const base = loadBaseRulePackage({ engineVersion: ENGINE_VERSION });
  assert.equal(base.manifest.packageId, "base_rules");
  assert.ok(!base.manifest.rules.some(({ id }) => loaded.manifest.rules.some((draft) => draft.id === id)));
});
