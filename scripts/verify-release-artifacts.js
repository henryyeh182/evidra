#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_MANIFEST } from "../packages/release/src/index.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const archive = process.argv[2] || join(rootDir, "dist/pacevera.mcpb");
const expectedTools = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"))
  .tools.map((tool) => tool.name).sort();

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function sha256(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function fail(message) { throw new Error(`Release artifact gate failed: ${message}`); }

if (!existsSync(archive)) fail(`archive does not exist: ${archive}`);
const work = mkdtempSync(join(tmpdir(), "pacevera-artifact-"));
try {
  execFileSync("unzip", ["-oq", archive, "-d", work]);
  const release = readJson(join(work, "release-manifest.json"));
  const product = readJson(join(work, "package.json"));
  const extension = readJson(join(work, "manifest.json"));
  if (release.releaseVersion !== RELEASE_MANIFEST.releaseVersion) fail("releaseVersion differs from source.");
  if (release.engineVersion !== RELEASE_MANIFEST.engineVersion) fail("engineVersion differs from source.");
  if (release.libraryChecksum !== RELEASE_MANIFEST.libraryChecksum) fail("libraryChecksum differs from source.");
  if (product.version !== release.releaseVersion || extension.version !== release.releaseVersion) fail("product metadata differs from release manifest.");

  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ].map((message) => `${JSON.stringify(message)}\n`).join("");
  const process = spawnSync("node", [join(work, "dist/evidra-server.mjs")], { input, encoding: "utf8" });
  if (process.status !== 0) fail(`bundled server exited ${process.status}: ${process.stderr}`);
  const responses = process.stdout.trim().split("\n").map(JSON.parse);
  const info = responses[0]?.result?.serverInfo;
  const tools = (responses[1]?.result?.tools || []).map((tool) => tool.name).sort();
  if (info?.releaseVersion !== RELEASE_MANIFEST.releaseVersion || info?.engineVersion !== RELEASE_MANIFEST.engineVersion || info?.libraryChecksum !== RELEASE_MANIFEST.libraryChecksum) {
    fail("initialize serverInfo does not expose the bundled release identity.");
  }
  if (JSON.stringify(tools) !== JSON.stringify(expectedTools)) fail("tools/list differs from the source contract.");
  console.log(`artifact parity valid: ${archive} sha256:${sha256(archive)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
