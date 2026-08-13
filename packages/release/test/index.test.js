import assert from "node:assert/strict";
import test from "node:test";
import { RELEASE_IDENTITY, RELEASE_MANIFEST } from "../src/index.js";

test("release manifest exposes one coherent runtime identity", () => {
  assert.equal(RELEASE_MANIFEST.releaseVersion, "0.5.1");
  assert.equal(RELEASE_MANIFEST.engineVersion, "1.6.0");
  assert.equal(RELEASE_MANIFEST.libraryVersion, "1.5.0");
  assert.equal(RELEASE_MANIFEST.activeRulePackages[0].packageId, "base_rules");
  assert.equal(RELEASE_IDENTITY.libraryChecksum, RELEASE_MANIFEST.libraryChecksum);
});

test("release manifest rejects a changed checksum", async () => {
  const { assertReleaseManifest } = await import("../src/index.js");
  assert.throws(() => assertReleaseManifest({ ...RELEASE_MANIFEST, libraryChecksum: "sha256:bad" }), /libraryChecksum/);
});
