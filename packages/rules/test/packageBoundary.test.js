import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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
  assert.equal(loaded.manifest.version, "1.1.0");
  assert.deepEqual(loaded.manifest.evidencePackets, [
    "evidence/EP-001.json",
    "evidence/EP-002.json",
    "evidence/EP-003.json",
    "evidence/EP-004.json",
    "evidence/EP-005.json"
  ]);
  for (const packetPath of loaded.manifest.evidencePackets) {
    const packet = loaded.ruleFiles.get(packetPath);
    assert.match(packet.packet_id, /^EP-[0-9]{3}$/);
    assert.ok(packet.applicable_rule_ids.every((id) => loaded.manifest.rules.some((rule) => rule.id === id)));
  }
});

test("package validation rejects duplicate rule identity and checksum drift", () => {
  const packageDir = join(root, "rule-packages", "base_rules");
  assert.throws(() => validateRulePackage(packageDir, { engineVersion: "2.0.0" }), /incompatible/);
  assert.throws(() => validateRulePackage(packageDir, { engineVersion: "1.5.0" }), /incompatible/);
});

test("the manifest schema is executable and empty domain packages are explicit", async () => {
  const running = validateRulePackage(join(root, "rule-packages", "running_rules"), { engineVersion: ENGINE_VERSION });
  assert.equal(running.manifest.status, "draft");
  assert.deepEqual(running.manifest.rules, []);
  assert.deepEqual(running.manifest.contentFiles, []);
  assert.match(running.manifest.contentChecksum, /^sha256:0{64}$/);

  const temporary = await mkdtemp(join(tmpdir(), "pacevera-rule-package-"));
  try {
    await writeFile(join(temporary, "package.json"), JSON.stringify({
      packageId: "temporary",
      version: "0.0.0",
      schemaVersion: "1.0.0",
      status: "draft",
      tier: "domain",
      engineCompatibility: { min: "1.6.0", max: "<2.0.0" },
      rules: [],
      contentFiles: [],
      contentChecksum: "sha256:" + "0".repeat(64),
      reviewRecord: 42
    }));
    assert.throws(() => validateRulePackage(temporary, { engineVersion: ENGINE_VERSION }), /must be string/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
