import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const viewer = join(dirname(fileURLToPath(import.meta.url)), "../decision-graph-viewer.html");

test("Decision Graph viewer is a local file viewer with the required controls", async () => {
  const html = await readFile(viewer, "utf8");
  for (const marker of ["primary", "comparison", "caseSelect", "rulesOnly", "suppressed", "diffOnly", "data-node", "FileReader"]) {
    assert.ok(html.includes(marker), `viewer is missing ${marker}`);
  }
  assert.ok(!html.includes("fetch("), "viewer must not fetch remote data");
  assert.ok(html.includes("harness/regression-baseline.json"), "viewer should name the default baseline");
});
