import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listedToolDefinitions } from "../src/toolDefinitions.js";
import { LOCAL_DECISION_TOOL } from "../../local-engine/src/server.js";

const root = new URL("../../../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const readme = await readFile(new URL("README.md", root), "utf8");
const serverDocs = await readFile(new URL("docs/mcp-server.md", root), "utf8");

test("the ten hosted tools plus the one local-only tool are the same names in runtime, manifest, and public docs", () => {
  const hostedRuntime = listedToolDefinitions("test").map((tool) => tool.name);
  // manifest.json describes the packaged .mcpb, whose entry point is the
  // local engine (scripts/build-bundle.js) — it advertises the ten hosted
  // tools plus evidra_local_decide_today, which only that entry point adds
  // at tools/list time (apps/local-engine/src/server.js). Neither list
  // should silently drift from what the bundle actually exposes.
  const bundledRuntime = [...hostedRuntime, LOCAL_DECISION_TOOL.name];
  const manifestNames = manifest.tools.map((tool) => tool.name);
  assert.deepEqual(manifestNames.sort(), bundledRuntime.slice().sort());
  for (const name of bundledRuntime) {
    assert.ok(readme.includes(`\`${name}\``), `${name} missing from README tool table`);
    assert.ok(serverDocs.includes(`\`${name}\``), `${name} missing from MCP server docs`);
  }
});
