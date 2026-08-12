// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Pacevera — proprietary. See LICENSE at the repository root.

import { releaseManifestJson } from "./releaseManifestSource.js";

const SEMVER = /^\d+\.\d+\.\d+$/;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/;

function fail(message) {
  throw new Error(`Release manifest invariant violated: ${message}`);
}

function assertSemver(value, field) {
  if (!SEMVER.test(value || "")) fail(`${field} must be semver.`);
}

export function assertReleaseManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) fail("schemaVersion must be 1.");
  assertSemver(manifest.releaseVersion, "releaseVersion");
  assertSemver(manifest.engineVersion, "engineVersion");
  assertSemver(manifest.libraryVersion, "libraryVersion");
  if (!CHECKSUM.test(manifest.libraryChecksum || "")) fail("libraryChecksum must be sha256:<64 hex>." );
  if (!Array.isArray(manifest.activeRulePackages) || manifest.activeRulePackages.length === 0) {
    fail("activeRulePackages must contain at least one package.");
  }
  for (const [index, pkg] of manifest.activeRulePackages.entries()) {
    if (!pkg.packageId || !SEMVER.test(pkg.version || "")) fail(`activeRulePackages[${index}] has an invalid identity.`);
    if (!CHECKSUM.test(pkg.contentChecksum || "")) fail(`activeRulePackages[${index}].contentChecksum is invalid.`);
    if (!pkg.engineCompatibility?.min || !pkg.engineCompatibility?.max) fail(`activeRulePackages[${index}] has incomplete engineCompatibility.`);
  }
  if (manifest.gitCommit !== null && !/^[0-9a-f]{7,40}$/.test(manifest.gitCommit || "")) fail("gitCommit must be a git SHA or null.");
  if (manifest.imageDigest !== null && typeof manifest.imageDigest !== "string") fail("imageDigest must be a string or null.");
  return Object.freeze(structuredClone(manifest));
}

export const RELEASE_MANIFEST = assertReleaseManifest(JSON.parse(releaseManifestJson));

export const RELEASE_IDENTITY = Object.freeze({
  releaseVersion: RELEASE_MANIFEST.releaseVersion,
  engineVersion: RELEASE_MANIFEST.engineVersion,
  libraryVersion: RELEASE_MANIFEST.libraryVersion,
  libraryChecksum: RELEASE_MANIFEST.libraryChecksum,
  activeRulePackages: RELEASE_MANIFEST.activeRulePackages
});
