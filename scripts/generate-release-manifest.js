#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRulePackage } from "../packages/rules/src/packageBoundary.js";
import { ENGINE_VERSION } from "../packages/decision-engine/src/version.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const productManifest = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"));
const baseDir = join(rootDir, "rule-packages/base_rules");
const base = validateRulePackage(baseDir, { engineVersion: ENGINE_VERSION });
const baseManifest = base.manifest;
const sessionRules = JSON.parse(readFileSync(join(baseDir, "rules/session-rules.json"), "utf8"));

if (productManifest.version !== packageJson.version) throw new Error("manifest.json and package.json versions differ.");
const gitCommit = (() => {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim(); }
  catch { return null; }
})();

const releaseManifest = {
  schemaVersion: 1,
  releaseVersion: packageJson.version,
  engineVersion: ENGINE_VERSION,
  libraryVersion: sessionRules.version,
  libraryChecksum: baseManifest.contentChecksum,
  activeRulePackages: [{
    packageId: baseManifest.packageId,
    version: baseManifest.version,
    contentChecksum: baseManifest.contentChecksum,
    engineCompatibility: baseManifest.engineCompatibility
  }],
  gitCommit,
  imageDigest: null
};

writeFileSync(join(rootDir, "release-manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
console.log(`generated release-manifest.json for ${releaseManifest.releaseVersion} (${gitCommit || "no git metadata"})`);
