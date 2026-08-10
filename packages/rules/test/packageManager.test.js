import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ENGINE_VERSION } from "../../decision-engine/src/version.js";
import { commitInstall, readActive, rollbackPackage, validateCandidate } from "../src/packageManager.js";

const root = join(new URL("../../../", import.meta.url).pathname);

async function copyBase(target, version = "1.0.0") {
  await cp(join(root, "rule-packages", "base_rules"), target, { recursive: true });
  const manifestPath = join(target, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("R1 installs immutable versions and rolls back to the previous active pointer", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pacevera-r1-"));
  try {
    const sourceV1 = join(workspace, "source-v1", "base_rules");
    const sourceV2 = join(workspace, "source-v2", "base_rules");
    await copyBase(sourceV1, "1.0.0");
    await copyBase(sourceV2, "1.0.1");
    const store = join(workspace, "store");
    const candidateV1 = validateCandidate(sourceV1, { engineVersion: ENGINE_VERSION });
    const candidateV2 = validateCandidate(sourceV2, { engineVersion: ENGINE_VERSION });

    const verification = { scenarios: 37, findings: 0, errors: 0, decisionDiffs: [] };
    await commitInstall({ storeDir: store, sourceDir: sourceV1, candidate: candidateV1, verification });
    await commitInstall({ storeDir: store, sourceDir: sourceV2, candidate: candidateV2, verification });
    assert.equal((await readActive(store)).version, "1.0.1");

    const rolledBack = await rollbackPackage(store, "base_rules", { engineVersion: ENGINE_VERSION });
    assert.equal(rolledBack.version, "1.0.0");
    assert.equal((await readActive(store)).version, "1.0.0");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("an immutable version cannot be overwritten and a failed candidate changes no pointer", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pacevera-r1-"));
  try {
    const source = join(workspace, "source", "base_rules");
    await copyBase(source);
    const store = join(workspace, "store");
    const candidate = validateCandidate(source, { engineVersion: ENGINE_VERSION });
    await commitInstall({ storeDir: store, sourceDir: source, candidate, verification: { scenarios: 37, findings: 0, errors: 0, decisionDiffs: [] } });
    const before = await readActive(store);

    const invalid = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    invalid.contentChecksum = `sha256:${"f".repeat(64)}`;
    await writeFile(join(source, "package.json"), `${JSON.stringify(invalid, null, 2)}\n`);
    assert.throws(() => validateCandidate(source, { engineVersion: ENGINE_VERSION }), /contentChecksum mismatch/);
    assert.deepEqual(await readActive(store), before);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
