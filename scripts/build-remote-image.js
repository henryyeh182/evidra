#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = JSON.parse(readFileSync(join(rootDir, "release-manifest.json"), "utf8"));
const image = process.argv[2] || `pacevera-server:${release.releaseVersion}`;
execFileSync("docker", [
  "build", "--label", `org.opencontainers.image.version=${release.releaseVersion}`,
  "--label", `io.pacevera.engine-version=${release.engineVersion}`,
  "--label", `io.pacevera.library-checksum=${release.libraryChecksum}`,
  "-t", image, "."
], { cwd: rootDir, stdio: "inherit" });
console.log(`built immutable remote image ${image}`);
