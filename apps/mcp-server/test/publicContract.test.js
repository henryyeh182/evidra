import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { listedToolDefinitions } from "../src/toolDefinitions.js";

const root = new URL("../../../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const readme = await readFile(new URL("README.md", root), "utf8");
const serverDocs = await readFile(new URL("docs/mcp-server.md", root), "utf8");

test("the ten advertised tools are the same names in runtime, manifest, and public docs", () => {
  const runtime = listedToolDefinitions("test").map((tool) => tool.name);
  const manifestNames = manifest.tools.map((tool) => tool.name);
  assert.deepEqual(manifestNames.sort(), runtime.slice().sort());
  for (const name of runtime) {
    assert.ok(readme.includes(`\`${name}\``), `${name} missing from README tool table`);
    assert.ok(serverDocs.includes(`\`${name}\``), `${name} missing from MCP server docs`);
  }
});
