import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { runHarness } from "../runner.js";
import {
  buildRegressionBaseline,
  compareRegression,
  validateRegressionBaseline
} from "../lib/regression.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("the checked-in regression baseline has a fixed schema and no current drift", async () => {
  const baseline = await validateRegressionBaseline(
    JSON.parse(await readFile(join(root, "harness/regression-baseline.json"), "utf8"))
  );
  const actual = buildRegressionBaseline(await runHarness());
  const diff = compareRegression(baseline, actual);
  assert.equal(baseline.schemaVersion, "1.0.0");
  assert.equal(baseline.cases.length, 37);
  assert.deepEqual(diff, { added: [], removed: [], decisionDiffs: [], graphDiffs: [] });
});

test("regression gate catches a changed decision and its graph", async () => {
  const baseline = await validateRegressionBaseline(
    JSON.parse(await readFile(join(root, "harness/regression-baseline.json"), "utf8"))
  );
  const actual = structuredClone(baseline);
  actual.cases[0].decision.decision.type = "adjust";
  actual.cases[0].graph.nodes.find((node) => node.id === "decision").value.type = "adjust";
  const diff = compareRegression(baseline, actual);
  assert.deepEqual(diff.decisionDiffs.map(({ id }) => id), [baseline.cases[0].id]);
  assert.deepEqual(diff.graphDiffs.map(({ id }) => id), [baseline.cases[0].id]);
});

test("regression gate catches an edge-only Decision Graph change", async () => {
  const baseline = await validateRegressionBaseline(
    JSON.parse(await readFile(join(root, "harness/regression-baseline.json"), "utf8"))
  );
  const actual = structuredClone(baseline);
  actual.cases[1].graph.edges[0].reason = "tampered";
  const diff = compareRegression(baseline, actual);
  assert.deepEqual(diff.decisionDiffs, []);
  assert.deepEqual(diff.graphDiffs.map(({ id }) => id), [baseline.cases[1].id]);
});

test("regression baseline validation rejects an empty corpus", async () => {
  const baseline = {
    schemaVersion: "1.0.0",
    corpus: {
      id: "test",
      description: "test",
      source: "test",
      groundTruth: "behavioral_regression_baseline"
    },
    cases: []
  };
  await assert.rejects(() => validateRegressionBaseline(baseline), /minItems|invalid/i);
});
