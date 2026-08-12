#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const release = JSON.parse(readFileSync(join(rootDir, "release-manifest.json"), "utf8"));
const image = process.argv[2] || `pacevera-server:${release.releaseVersion}`;
const container = `pacevera-smoke-${process.pid}`;
const port = 18787;
const run = (args, options = {}) => execFileSync("docker", args, { encoding: "utf8", ...options });
try {
  run(["run", "-d", "--name", container, "-p", `${port}:8787`, image]);
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const health = run(["-fsS", `http://127.0.0.1:${port}/health`]);
      if (JSON.parse(health).status === "ok") { healthy = true; break; }
    } catch { /* container is still starting */ }
  }
  if (!healthy) throw new Error("remote image health endpoint did not become ready.");
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const response = run(["-fsS", "-X", "POST", "-H", "content-type: application/json", "--data", request, `http://127.0.0.1:${port}/mcp`]);
  const info = JSON.parse(response).result?.serverInfo;
  if (info?.releaseVersion !== release.releaseVersion || info?.engineVersion !== release.engineVersion) {
    throw new Error("remote initialize identity differs from release-manifest.json.");
  }
  console.log(`remote image smoke passed: ${image}`);
} finally {
  try { run(["rm", "-f", container]); } catch { /* preserve the original failure */ }
}
