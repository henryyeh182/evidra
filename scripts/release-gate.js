#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
function run(command, commandArgs) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, { cwd: rootDir, stdio: "inherit" });
}

run("npm", ["run", "release:validate"]);
run("npm", ["run", "package:validate"]);
run("npm", ["run", "package:dry-run"]);
run("node", ["--test", "packages/release/test/index.test.js"]);
run("npm", ["run", "build:bundle"]);
if (!args.has("--skip-archive")) {
  if (!existsSync(join(rootDir, "dist/pacevera.mcpb"))) {
    throw new Error("dist/pacevera.mcpb is missing; run npm run pack before the artifact gate.");
  }
  run("node", ["scripts/verify-release-artifacts.js"]);
}
if (!args.has("--skip-remote")) {
  console.log("remote image gate: skipped (pass --build-remote to build with Docker)");
}
if (args.has("--build-remote")) run("node", ["scripts/build-remote-image.js"]);
console.log("\nrelease gate passed");
