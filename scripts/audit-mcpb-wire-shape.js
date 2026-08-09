#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REL_DIR =
  "/private/tmp/claude-501/-Users-henry-dev-fitness-mcp/0582b5b2-8590-44a6-b458-0ec3e1ed8ca6/scratchpad/rel";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith("--")) {
    args.set(process.argv[i], process.argv[i + 1]);
    i += 1;
  }
}

const relDir = args.get("--rel-dir") || DEFAULT_REL_DIR;
const historical = [
  "v0.1.0",
  "v0.1.1",
  "v0.2.0",
  "v0.3.0",
  "v0.3.3",
  "v0.3.4",
  "v0.3.5",
  "v0.3.6",
  "v0.3.7",
  "v0.4.0"
].map((version) => [version, join(relDir, `${version}.mcpb`)]);

const archives = [
  ...historical.filter(([, archive]) => existsSync(archive)),
  ["new-local", join(rootDir, "dist/evidra.mcpb")]
].filter(([, archive]) => existsSync(archive));

if (archives.length === 0) {
  console.error(`No .mcpb files found. Expected historical files under ${relDir}, or dist/evidra.mcpb.`);
  process.exit(1);
}

function frame(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function notify(method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
}

function runServer(cwd, entryPoint, input) {
  const raw = execFileSync("node", [entryPoint], {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "ignore"]
  }).trim();
  return raw ? raw.split("\n").map((line) => JSON.parse(line)) : [];
}

console.log([
  "version".padEnd(10),
  "manifest".padEnd(8),
  "server".padEnd(8),
  "tools",
  "payload",
  "digest",
  "outputSchema",
  "structured",
  "resultKeys",
  "substitutionTool"
].join(" | "));
console.log("-".repeat(124));

let failed = 0;
for (const [label, archive] of archives) {
  const work = mkdtempSync(join(tmpdir(), "evidra-wire-"));
  try {
    execFileSync("unzip", ["-oq", archive, "-d", work], { stdio: "ignore" });
    const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8"));
    const init = frame(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "wire-shape-audit", version: "1" }
    });
    const listMessages = runServer(
      work,
      manifest.server.entry_point,
      init + notify("notifications/initialized") + frame(2, "tools/list")
    );
    const initialize = listMessages.find((message) => message.id === 1);
    const listed = listMessages.find((message) => message.id === 2);
    const tools = listed?.result?.tools || [];
    const payload = JSON.stringify(tools);
    const outputSchemaCount = tools.filter((tool) => tool.outputSchema).length;
    const substitution = tools.find((tool) => /substitution/.test(tool.name));

    let structuredBytes = 0;
    let resultKeys = "";
    if (substitution) {
      const callMessages = runServer(
        work,
        manifest.server.entry_point,
        init +
          notify("notifications/initialized") +
          frame(3, "tools/call", {
            name: substitution.name,
            arguments: {
              exerciseId: "back squat",
              conditions: ["knee_injury"],
              availableEquipment: ["bodyweight"],
              avoidContraindications: ["knee"]
            }
          })
      );
      const called = callMessages.find((message) => message.id === 3);
      if (called?.error) {
        resultKeys = `ERROR:${called.error.message}`;
      } else {
        const result = called?.result || {};
        resultKeys = Object.keys(result).sort().join(",");
        structuredBytes = result.structuredContent
          ? Buffer.byteLength(JSON.stringify(result.structuredContent), "utf8")
          : 0;
      }
    }

    if (label === "new-local" && (outputSchemaCount > 0 || structuredBytes > 0)) {
      failed += 1;
    }

    console.log([
      label.padEnd(10),
      String(manifest.version || "").padEnd(8),
      String(initialize?.result?.serverInfo?.version || "").padEnd(8),
      String(tools.length).padStart(5),
      String(Buffer.byteLength(payload, "utf8")).padStart(7),
      createHash("sha256").update(payload).digest("hex").slice(0, 8),
      String(outputSchemaCount).padStart(12),
      String(structuredBytes).padStart(10),
      resultKeys.padEnd(24),
      substitution?.name || ""
    ].join(" | "));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error("\nnew-local regressed: tools/list outputSchema or tools/call structuredContent came back.");
  process.exit(1);
}
