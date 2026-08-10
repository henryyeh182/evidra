#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra - proprietary. See LICENSE at the repository root.

/**
 * Release/install smoke verification for the shipped MCPB.
 *
 * This is deliberately separate from `npm test`: it touches release URLs and,
 * when present, the local Claude Desktop extension directory. It is meant to be
 * rerun after a release or install, not on every edit.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_REPO = "henryyeh182/evidra";
const REGISTRY_NAME = "io.github.henryyeh182/evidra";
const REGISTRY_SEARCH = "https://registry.modelcontextprotocol.io/v0/servers?search=evidra";
const TOOLSET_META_KEY = "io.github.henryyeh182/evidra/toolsetVersion";
const DEFAULT_ARCHIVE = join(rootDir, "dist/pacevera.mcpb");
const DEFAULT_CLAUDE_EXTENSION = join(
  homedir(),
  "Library/Application Support/Claude/Claude Extensions/local.mcpb.henry-yeh.pacevera"
);
const DEFAULT_CLAUDE_SETTINGS = join(
  homedir(),
  "Library/Application Support/Claude/Claude Extensions Settings/local.mcpb.henry-yeh.pacevera.json"
);

const args = new Map();
const flags = new Set();
for (let i = 2; i < process.argv.length; i += 1) {
  const item = process.argv[i];
  if (!item.startsWith("--")) continue;
  if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) {
    args.set(item, process.argv[i + 1]);
    i += 1;
  } else {
    flags.add(item);
  }
}

const archive = args.get("--archive") || DEFAULT_ARCHIVE;
const installed = args.get("--installed") || DEFAULT_CLAUDE_EXTENSION;
const skipOnline = flags.has("--skip-online");
const skipClaude = flags.has("--skip-claude");

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function frame(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function notify(method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`;
}

function runServer(cwd, entryPoint, input) {
  const raw = sh("node", [entryPoint], {
    cwd,
    input,
    stdio: ["pipe", "pipe", "ignore"]
  }).trim();
  return raw ? raw.split("\n").map((line) => JSON.parse(line)) : [];
}

function parseToolResult(message) {
  const text = message?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

function runProtocolSmoke(label, cwd, manifest, expectedVersion) {
  const init = frame(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "release-install-smoke", version: "1" }
  });
  const input =
    init +
    notify("notifications/initialized") +
    frame(2, "tools/list") +
    frame(3, "tools/call", {
      name: "decide_exercise_substitution",
      arguments: {
        exerciseId: "back squat",
        conditions: ["knee_injury"],
        availableEquipment: ["bodyweight"],
        avoidContraindications: ["knee"]
      }
    }) +
    frame(4, "tools/call", {
      name: "generate_plan",
      arguments: {
        startDate: "2026-08-10",
        weeks: 1,
        evidence: {
          profile: { timezone: "UTC", fitnessLevel: "intermediate" },
          goals: [{ type: "half_marathon", label: "Half marathon" }],
          constraints: { availableMinutes: 45, equipment: ["outdoor"] }
        }
      }
    });

  let messages;
  try {
    messages = runServer(cwd, manifest.server.entry_point, input);
  } catch (error) {
    fail(`${label}: entry point failed to complete protocol smoke (${error.message.split("\n")[0]})`);
    return null;
  }

  const initialized = messages.find((message) => message.id === 1);
  const listed = messages.find((message) => message.id === 2);
  const substitution = messages.find((message) => message.id === 3);
  const plan = messages.find((message) => message.id === 4);
  const tools = listed?.result?.tools || [];

  if (initialized?.result?.serverInfo?.version !== expectedVersion) {
    fail(`${label}: initialize version ${initialized?.result?.serverInfo?.version || "(missing)"} != ${expectedVersion}`);
  }
  if (tools.length === 0) fail(`${label}: tools/list returned no tools`);

  const manifestToolNames = new Set((manifest.tools || []).map((tool) => tool.name));
  for (const name of manifestToolNames) {
    if (!tools.some((tool) => tool.name === name)) {
      fail(`${label}: tools/list is missing ${name} from manifest.tools`);
    }
  }
  for (const tool of tools) {
    if (tool.outputSchema) fail(`${label}: ${tool.name} exposed outputSchema in tools/list`);
    if (tool._meta?.[TOOLSET_META_KEY] !== expectedVersion) {
      fail(`${label}: ${tool.name} toolset version ${tool._meta?.[TOOLSET_META_KEY] || "(missing)"} != ${expectedVersion}`);
    }
  }

  for (const [message, name] of [
    [substitution, "decide_exercise_substitution"],
    [plan, "generate_plan"]
  ]) {
    if (message?.error) {
      fail(`${label}: ${name} failed (${message.error.message})`);
      continue;
    }
    if (message?.result?.structuredContent) {
      fail(`${label}: ${name} returned structuredContent; release wire shape is content-only`);
    }
  }

  const substitutionPayload = parseToolResult(substitution);
  if (!substitutionPayload?.decisionBasis || !substitutionPayload?.action?.from?.exercise_id) {
    fail(`${label}: substitution call did not return an action and decisionBasis`);
  }
  const planPayload = parseToolResult(plan);
  if (planPayload?.version !== 1 || planPayload?.status !== "planned" || !planPayload?.decisionBasis) {
    fail(`${label}: generate_plan did not return a planned v1 plan with decisionBasis`);
  }

  return {
    toolCount: tools.length,
    toolDigest: createHash("sha256").update(JSON.stringify(tools)).digest("hex"),
    substitutionRule: substitutionPayload?.decisionBasis?.governingRule?.ruleId || null,
    planId: planPayload?.id || null
  };
}

function unzipArchive(label, path) {
  const work = mkdtempSync(join(tmpdir(), "pacevera-release-smoke-"));
  try {
    sh("unzip", ["-oq", path, "-d", work], { stdio: "ignore" });
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    fail(`${label}: cannot unzip ${path} (${error.message.split("\n")[0]})`);
    return null;
  }
  return work;
}

function archiveList(path) {
  return sh("unzip", ["-Z1", path]).trim().split("\n").filter(Boolean);
}

function checkArchiveShape(label, path, extracted, serverJson, rootManifest, rootPackage) {
  const files = archiveList(path);
  const manifest = readJson(join(extracted, "manifest.json"));
  const pkg = readJson(join(extracted, "package.json"));
  const entryPoint = join(extracted, manifest.server?.entry_point || "");

  if (sha256(path) !== serverJson.packages?.[0]?.fileSha256) {
    fail(`${label}: sha256 ${sha256(path)} != server.json ${serverJson.packages?.[0]?.fileSha256 || "(missing)"}`);
  }
  if (manifest.version !== serverJson.version || manifest.version !== rootManifest.version || manifest.version !== rootPackage.version) {
    fail(`${label}: manifest/package/server versions disagree`);
  }
  if (pkg.version !== manifest.version) {
    fail(`${label}: bundled package version ${pkg.version} != manifest ${manifest.version}`);
  }
  if (manifest.server?.entry_point !== "dist/evidra-server.mjs") {
    fail(`${label}: unexpected entry point ${manifest.server?.entry_point || "(missing)"}`);
  }
  if (!existsSync(entryPoint)) {
    fail(`${label}: entry point ${manifest.server?.entry_point} is missing`);
  }
  if (Object.keys(pkg.dependencies || {}).length > 0) {
    fail(`${label}: bundled package has runtime dependencies`);
  }

  for (const required of ["LICENSE", "README.md", "manifest.json", "package.json", "icon.png", "dist/evidra-server.mjs"]) {
    if (!files.includes(required)) fail(`${label}: archive missing ${required}`);
  }
  for (const prefix of ["apps/", "packages/", "scripts/", "harness/", "schemas/", "docs/", "node_modules/", "data/private/"]) {
    if (files.some((file) => file.startsWith(prefix))) {
      fail(`${label}: archive includes excluded development/private path ${prefix}`);
    }
  }
  for (const forbidden of ["server.json", "package-lock.json"]) {
    if (files.includes(forbidden)) fail(`${label}: archive includes ${forbidden}`);
  }

  return { files, manifest, pkg, entryPoint };
}

function download(url, destination) {
  sh("curl", ["-fsSL", "-o", destination, url]);
}

function curlJson(url) {
  return JSON.parse(sh("curl", ["-fsSL", url]));
}

function checkOnline(serverJson, rootManifest) {
  if (skipOnline) {
    note("online: skipped by --skip-online");
    return;
  }

  const releaseWork = mkdtempSync(join(tmpdir(), "pacevera-release-online-"));
  try {
    const release = curlJson(`https://api.github.com/repos/${PUBLIC_REPO}/releases/latest`);
    if (release.tag_name !== `v${serverJson.version}`) {
      fail(`online: GitHub latest ${release.tag_name || "(missing)"} != v${serverJson.version}`);
    }
    const asset = (release.assets || []).find((item) => item.name === "pacevera.mcpb");
    if (!asset) {
      fail("online: GitHub latest release has no pacevera.mcpb asset");
    } else if (asset.browser_download_url !== serverJson.packages?.[0]?.identifier) {
      fail(`online: GitHub asset URL ${asset.browser_download_url} != server.json identifier`);
    }

    const downloaded = join(releaseWork, "pacevera.mcpb");
    download(serverJson.packages[0].identifier, downloaded);
    const downloadedSha = sha256(downloaded);
    if (downloadedSha !== serverJson.packages[0].fileSha256) {
      fail(`online: downloaded release sha256 ${downloadedSha} != server.json ${serverJson.packages[0].fileSha256}`);
    }

    const downloadedExtracted = unzipArchive("online release archive", downloaded);
    if (downloadedExtracted) {
      const downloadedManifest = readJson(join(downloadedExtracted, "manifest.json"));
      if (downloadedManifest.version !== rootManifest.version) {
        fail(`online: downloaded manifest version ${downloadedManifest.version} != local manifest ${rootManifest.version}`);
      }
      rmSync(downloadedExtracted, { recursive: true, force: true });
    }

    const listing = curlJson(REGISTRY_SEARCH);
    const latest = (listing.servers || [])
      .map((entry) => ({ srv: entry.server || entry, meta: entry._meta?.["io.modelcontextprotocol.registry/official"] || {} }))
      .find(({ srv, meta }) => srv.name === REGISTRY_NAME && meta.isLatest);
    if (!latest) {
      fail(`online: registry latest entry not found for ${REGISTRY_NAME}`);
      return;
    }
    const pkg = latest.srv.packages?.[0] || {};
    if (latest.srv.version !== serverJson.version) {
      fail(`online: registry version ${latest.srv.version} != server.json ${serverJson.version}`);
    }
    if (pkg.identifier !== serverJson.packages[0].identifier) {
      fail(`online: registry identifier ${pkg.identifier || "(missing)"} != server.json identifier`);
    }
    if (pkg.fileSha256 !== serverJson.packages[0].fileSha256) {
      fail(`online: registry sha256 ${pkg.fileSha256 || "(missing)"} != server.json sha256`);
    }
    if (pkg.registryType !== "mcpb" || pkg.transport?.type !== "stdio") {
      fail(`online: registry package shape is not mcpb/stdio`);
    }
  } catch (error) {
    fail(`online: release/registry check could not complete (${error.message.split("\n")[0]})`);
  } finally {
    rmSync(releaseWork, { recursive: true, force: true });
  }
}

function checkInstalled(serverJson, archiveExtracted, archiveManifest) {
  if (skipClaude) {
    note("Claude install: skipped by --skip-claude");
    return;
  }
  if (!existsSync(installed)) {
    note(`Claude install: no extension directory at ${installed}`);
    return;
  }

  const manifestPath = join(installed, "manifest.json");
  const packagePath = join(installed, "package.json");
  const entryPath = join(installed, archiveManifest.server.entry_point);
  if (!existsSync(manifestPath) || !existsSync(packagePath) || !existsSync(entryPath)) {
    fail("Claude install: installed extension is missing manifest, package, or entry point");
    return;
  }

  const installedManifest = readJson(manifestPath);
  const installedPackage = readJson(packagePath);
  if (!isDeepStrictEqual(installedManifest, archiveManifest)) {
    fail("Claude install: installed manifest differs from the release archive manifest");
  }
  if (installedPackage.version !== serverJson.version) {
    fail(`Claude install: installed package version ${installedPackage.version} != ${serverJson.version}`);
  }
  const archiveEntryHash = sha256(join(archiveExtracted, archiveManifest.server.entry_point));
  const installedEntryHash = sha256(entryPath);
  if (installedEntryHash !== archiveEntryHash) {
    fail(`Claude install: installed entry hash ${installedEntryHash} != archive entry hash ${archiveEntryHash}`);
  }
  if (existsSync(DEFAULT_CLAUDE_SETTINGS)) {
    const settings = readJson(DEFAULT_CLAUDE_SETTINGS);
    if (settings.isEnabled !== true) {
      fail("Claude install: extension settings do not show isEnabled=true");
    }
  } else {
    note("Claude install: settings file not found, so enabled state could not be asserted");
  }

  const protocol = runProtocolSmoke("Claude install", installed, installedManifest, serverJson.version);
  const mtime = statSync(manifestPath).mtime.toISOString();
  note(
    protocol
      ? `Claude install: manifest ${installedManifest.version}, entry hash ${installedEntryHash.slice(0, 16)}, tools digest ${protocol.toolDigest.slice(0, 16)}, installed ${mtime}`
      : `Claude install: manifest ${installedManifest.version}, installed ${mtime}`
  );
  note("Claude Desktop UI logs: not asserted; no stable per-extension tool-call log was found during read-only inspection");
}

function main() {
  const serverJson = readJson(join(rootDir, "server.json"));
  const rootManifest = readJson(join(rootDir, "manifest.json"));
  const rootPackage = readJson(join(rootDir, "package.json"));

  if (!existsSync(archive)) {
    fail(`archive not found: ${archive}`);
  }
  if (rootManifest.version !== serverJson.version || rootPackage.version !== serverJson.version) {
    fail("local manifest/package/server versions disagree");
  }
  if (serverJson.packages?.[0]?.registryType !== "mcpb" || serverJson.packages?.[0]?.transport?.type !== "stdio") {
    fail("server.json package is not mcpb/stdio");
  }

  let archiveWork = null;
  let archiveMeta = null;
  if (existsSync(archive)) {
    archiveWork = unzipArchive("local archive", archive);
    if (archiveWork) {
      archiveMeta = checkArchiveShape("local archive", archive, archiveWork, serverJson, rootManifest, rootPackage);
      if (archiveMeta) {
        const protocol = runProtocolSmoke("local archive", archiveWork, archiveMeta.manifest, serverJson.version);
        if (protocol) {
          note(
            `local archive: ${archiveMeta.files.length} files, sha256 ${sha256(archive).slice(0, 16)}, tools digest ${protocol.toolDigest.slice(0, 16)}`
          );
        }
      }
    }
  }

  checkOnline(serverJson, rootManifest);
  if (archiveWork && archiveMeta) checkInstalled(serverJson, archiveWork, archiveMeta.manifest);
  if (archiveWork) rmSync(archiveWork, { recursive: true, force: true });

  console.log("\nRelease/install smoke verification");
  console.log("==================================\n");
  console.log(`  version: v${serverJson.version}`);
  console.log(`  archive: ${archive}`);
  console.log(`  release: ${serverJson.packages?.[0]?.identifier || "(missing)"}`);
  console.log(`  registry: ${REGISTRY_NAME}\n`);

  for (const item of notes) console.log(`  info: ${item}`);
  if (notes.length > 0) console.log();

  if (failures.length > 0) {
    for (const item of failures) console.log(`  FAIL: ${item}`);
    console.log(`\n${failures.length} release/install smoke check(s) failed.\n`);
    process.exit(1);
  }

  console.log(
    skipOnline
      ? "  PASS: archive, stdio handshake, tools/list, tools/call, and requested install checks passed.\n"
      : "  PASS: archive, release metadata, registry metadata, stdio handshake, tools/list, tools/call, and requested install checks passed.\n"
  );
}

main();
