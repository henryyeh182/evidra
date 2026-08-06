#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Write the packed archive's identity into `server.json`.
 *
 * The official registry reads `version`, the download URL, and `fileSha256`
 * from that file, and all three have to describe the archive that is actually
 * on the release. Filling them by hand is how v0.2.0's stayed behind: the
 * numbers were right when written and nothing rechecked them.
 *
 * `server.json` is excluded from the archive precisely so this can work. If it
 * travelled inside, stamping the hash would change the hash being stamped.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const archivePath = join(rootDir, "dist/evidra.mcpb");

const { version } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"));

if (manifest.version !== version) {
  throw new Error(
    `manifest.json says ${manifest.version}, package.json says ${version}. ` +
      "They name the same release and have to agree before it is stamped."
  );
}

const archive = readFileSync(archivePath);
const sha256 = createHash("sha256").update(archive).digest("hex");

const serverJsonPath = join(rootDir, "server.json");
const server = JSON.parse(readFileSync(serverJsonPath, "utf8"));
const mcpb = server.packages?.find((entry) => entry.registryType === "mcpb");
if (!mcpb) throw new Error("server.json declares no mcpb package to stamp.");

server.version = version;
mcpb.identifier = mcpb.identifier.replace(/\/v[0-9.]+\//, `/v${version}/`);
mcpb.fileSha256 = sha256;

writeFileSync(serverJsonPath, `${JSON.stringify(server, null, 2)}\n`);

console.log(`stamped server.json for v${version}`);
console.log(`  ${mcpb.identifier}`);
console.log(`  sha256 ${sha256}`);
console.log(`  ${statSync(archivePath).size.toLocaleString()} bytes`);
console.log("\nThe download URL is not live until the release carries this file.");
