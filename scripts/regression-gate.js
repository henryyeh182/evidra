#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runHarness } from "../harness/runner.js";
import {
  buildRegressionBaseline,
  compareRegression,
  validateRegressionBaseline
} from "../harness/lib/regression.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPath = join(root, "harness/regression-baseline.json");
const args = process.argv.slice(2);
const update = args.includes("--update-baseline");
const baselinePath = args.includes("--baseline") ? resolve(args[args.indexOf("--baseline") + 1]) : defaultPath;

const harnessResult = await runHarness();
if (harnessResult.findings.length || harnessResult.errors.length) {
  console.error(`Harness failed: ${harnessResult.findings.length} findings, ${harnessResult.errors.length} errors.`);
  process.exitCode = 1;
} else {
  const actual = buildRegressionBaseline(harnessResult);
  if (update) {
    await writeFile(baselinePath, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`Regression baseline updated: ${baselinePath} (${actual.cases.length} cases).`);
  } else {
    const baseline = await validateRegressionBaseline(JSON.parse(await readFile(baselinePath, "utf8")));
    const diff = compareRegression(baseline, actual);
    console.log(JSON.stringify({
      verdict: diff.added.length || diff.removed.length || diff.decisionDiffs.length || diff.graphDiffs.length ? "fail" : "pass",
      baseline: baselinePath,
      cases: actual.cases.length,
      added: diff.added,
      removed: diff.removed,
      decisionDiffs: diff.decisionDiffs.map(({ id }) => id),
      graphDiffs: diff.graphDiffs.map(({ id }) => id)
    }, null, 2));
    if (diff.added.length || diff.removed.length || diff.decisionDiffs.length || diff.graphDiffs.length) process.exitCode = 1;
  }
}
