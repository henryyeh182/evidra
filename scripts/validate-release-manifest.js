#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseManifest } from "../packages/release/src/index.js";
import { validateRulePackage } from "../packages/rules/src/packageBoundary.js";
import { ENGINE_VERSION } from "../packages/decision-engine/src/version.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(join(rootDir, path), "utf8"));
const release = readJson("release-manifest.json");
const product = readJson("package.json");
const extension = readJson("manifest.json");
const base = validateRulePackage(join(rootDir, "rule-packages/base_rules"), { engineVersion: ENGINE_VERSION }).manifest;

assertReleaseManifest(release);
if (release.releaseVersion !== product.version || product.version !== extension.version) {
  throw new Error("releaseVersion, package.json and manifest.json must agree.");
}
if (release.engineVersion !== ENGINE_VERSION) throw new Error("release manifest engineVersion drifted from the engine.");
const active = release.activeRulePackages.find((pkg) => pkg.packageId === base.packageId);
if (!active) throw new Error(`release manifest does not declare active package ${base.packageId}.`);
for (const field of ["version", "contentChecksum", "engineCompatibility"]) {
  if (JSON.stringify(active[field]) !== JSON.stringify(base[field])) {
    throw new Error(`release manifest ${base.packageId}.${field} drifted from its package manifest.`);
  }
}
if (release.libraryChecksum !== base.contentChecksum) throw new Error("libraryChecksum drifted from the active base package.");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim();
const parent = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD^"], { cwd: rootDir, encoding: "utf8" }).trim(); }
  catch { return null; }
})();
if (release.gitCommit !== null && ![head, parent].includes(release.gitCommit)) {
  throw new Error(`release manifest gitCommit ${release.gitCommit} does not match HEAD ${head} or its parent ${parent}; regenerate it.`);
}

console.log(`release manifest valid: ${release.releaseVersion} / engine ${release.engineVersion} / ${active.packageId}@${active.version}`);
