#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv[2];
const repository = process.argv[3] || "pacevera-server";
if (!release || !/^\d+\.\d+\.\d+$/.test(release)) {
  throw new Error("Usage: node scripts/rollback-remote-image.js <immutable-release> [repository]");
}
const image = `${repository}:${release}`;
const inspect = execFileSync("docker", ["image", "inspect", image, "--format", "{{index .Config.Labels \"org.opencontainers.image.version\"}}"], { encoding: "utf8" }).trim();
if (inspect !== release) throw new Error(`Refusing rollback: ${image} is not labelled as release ${release}.`);
const manifest = JSON.parse(readFileSync(join(rootDir, "release-manifest.json"), "utf8"));
console.log(`rollback candidate verified: ${image}`);
console.log(`engine=${manifest.engineVersion}; base_rules=${manifest.activeRulePackages[0].version}`);
console.log("Deploy this immutable tag through the operator's platform; no mutable latest tag is changed by this command.");
