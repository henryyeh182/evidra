#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { ENGINE_VERSION } from "../packages/decision-engine/src/version.js";
import { loadBaseRulePackage } from "../packages/rules/src/packageBoundary.js";
import { commitInstall, rollbackPackage, validateCandidate } from "../packages/rules/src/packageManager.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultStore = join(root, "data", "private", "rule-package-store");

function usage() {
  console.error(`Usage:
  node scripts/rule-package.js validate <package-dir|archive>
  node scripts/rule-package.js dry-run <package-dir|archive> [--store <dir>]
  node scripts/rule-package.js install <package-dir|archive> [--store <dir>] [--confirm]
  node scripts/rule-package.js rollback <packageId> [--store <dir>]`);
  process.exitCode = 2;
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function packageDirInside(directory) {
  if (existsSync(join(directory, "package.json"))) return directory;
  const children = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const matches = children.map((entry) => join(directory, entry.name)).filter((candidate) => existsSync(join(candidate, "package.json")));
  if (matches.length !== 1) throw new Error("archive must contain exactly one directory with package.json");
  return matches[0];
}

async function materialize(source) {
  const absolute = resolve(source);
  if (existsSync(absolute) && !existsSync(join(absolute, "package.json"))) {
    const staging = await mkdtemp(join(tmpdir(), "pacevera-package-"));
    try {
      if (extname(absolute) === ".mcpb") execFileSync("unzip", ["-q", absolute, "-d", staging]);
      else execFileSync("tar", ["-xf", absolute, "-C", staging]);
      const extracted = packageDirInside(staging);
      const manifest = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
      const normalized = join(staging, manifest.packageId);
      if (resolve(extracted) !== resolve(normalized)) await cp(extracted, normalized, { recursive: true });
      return { directory: normalized, cleanup: () => rm(staging, { recursive: true, force: true }) };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  if (!existsSync(absolute)) throw new Error(`package source does not exist: ${absolute}`);
  return { directory: packageDirInside(absolute), cleanup: async () => {} };
}

function runHarness(packageDir = null) {
  const env = { ...process.env };
  if (packageDir) env.EVIDRA_RULE_PACKAGE_DIR = packageDir;
  else delete env.EVIDRA_RULE_PACKAGE_DIR;
  const result = spawnSync(process.execPath, [join(root, "scripts/run-harness-json.js")], {
    cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  let parsed;
  try { parsed = JSON.parse(result.stdout); }
  catch { throw new Error(`Decision Harness did not return JSON: ${result.stderr || result.stdout}`); }
  if (result.status !== 0) throw new Error(`Decision Harness failed: ${JSON.stringify(parsed)}`);
  return parsed;
}

function project(result) {
  return { decision: result.decision, action: result.action, decisionBasis: result.decisionBasis, confidence: result.confidence };
}

function diff(before, after) {
  const oldById = new Map(before.decisions.map((item) => [item.id, item]));
  return after.decisions.flatMap((item) => {
    const previous = oldById.get(item.id);
    return JSON.stringify(project(previous)) === JSON.stringify(project(item)) ? [] : [{
      scenario: item.id,
      before: project(previous),
      after: project(item),
      governingRuleBefore: previous?.decisionBasis?.governingRule?.ruleId || null,
      governingRuleAfter: item.decisionBasis?.governingRule?.ruleId || null,
      confidenceBefore: previous?.confidence || null,
      confidenceAfter: item.confidence || null
    }];
  });
}

async function dryRun(sourceDir) {
  const candidate = validateCandidate(sourceDir, { engineVersion: ENGINE_VERSION });
  const current = loadBaseRulePackage({ engineVersion: ENGINE_VERSION });
  const before = runHarness();
  const after = runHarness(sourceDir);
  return {
    verdict: "pass",
    candidate,
    current: { packageId: current.manifest.packageId, version: current.manifest.version, contentChecksum: current.manifest.contentChecksum },
    harness: { scenarios: after.scenarios, findings: after.findings.length, errors: after.errors.length, decisionDiffs: diff(before, after) }
  };
}

const [, , command, sourceOrId, ...rest] = process.argv;
if (!command) usage();
else {
  try {
    const store = option(rest, "--store", defaultStore);
    if (command === "rollback") {
      const result = await rollbackPackage(store, sourceOrId, { engineVersion: ENGINE_VERSION });
      console.log(JSON.stringify({ verdict: "rolled_back", active: result }, null, 2));
    } else {
      const materialized = await materialize(sourceOrId);
      try {
        if (command === "validate") {
          console.log(JSON.stringify(validateCandidate(materialized.directory, { engineVersion: ENGINE_VERSION }), null, 2));
        } else if (command === "dry-run" || command === "install") {
          const report = await dryRun(materialized.directory);
          console.log(JSON.stringify(report, null, 2));
          if (command === "install") {
            if (!rest.includes("--confirm")) throw new Error("install is a state-changing action; add --confirm after reviewing dry-run output.");
            const active = await commitInstall({ storeDir: store, sourceDir: materialized.directory, candidate: report.candidate, verification: { scenarios: report.harness.scenarios, findings: report.harness.findings, errors: report.harness.errors, decisionDiffs: report.harness.decisionDiffs } });
            console.log(JSON.stringify({ verdict: "installed", active }, null, 2));
          }
        } else usage();
      } finally { await materialized.cleanup(); }
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
