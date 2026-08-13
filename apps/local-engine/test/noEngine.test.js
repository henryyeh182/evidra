// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Covers the degraded mode createLocalMcpHandler falls into when no engine
// is available — the situation a Node runtime without node:sqlite (anything
// before 22.5) puts the packaged .mcpb in. The four evidence-accepting
// tools must still work; only evidra_local_decide_today and outcome/decision
// persistence should be affected.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createLocalMcpHandler, LOCAL_DECISION_TOOL, LOCAL_PREVIEW_TOOL } from "../src/server.js";
import { TODAY_BRIEF_RESOURCE_URI } from "../src/todayBriefApp.js";

const PRIVATE_DIR = fileURLToPath(new URL("../../../data/fixtures/pacevera-private", import.meta.url));

async function call(handle, method, params, id = 1) {
  return handle(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
}

test("createLocalMcpHandler({ engine: undefined }) does not throw", () => {
  assert.doesNotThrow(() => createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR }));
});

test("without an engine, tools/list omits evidra_local_decide_today", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const response = await call(handle, "tools/list", {}, 1);
  assert.equal(response.result.tools.some((t) => t.name === LOCAL_DECISION_TOOL.name), false);
  assert.equal(response.result.tools.some((t) => t.name === LOCAL_PREVIEW_TOOL.name), true);
});

test("the local evidence preview returns evidence without running a decision", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const response = await call(handle, "tools/call", { name: LOCAL_PREVIEW_TOOL.name, arguments: { date: "2026-07-22" } });
  assert.equal(response.error, undefined);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.evidenceBrief.available, true);
  assert.ok(payload.evidenceBrief.signalCounts.healthMetrics > 0);
  assert.equal(payload.evidence, undefined);
  assert.equal(payload._security, undefined);
  assert.equal(payload.nextStep.includes("wait for confirmation"), true);
});

test("UI-enabled tools advertise both current and legacy resource metadata", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const response = await call(handle, "tools/list", {}, 19);
  const preview = response.result.tools.find((tool) => tool.name === LOCAL_PREVIEW_TOOL.name);
  const decision = response.result.tools.find((tool) => tool.name === "decide_session");
  for (const tool of [preview, decision]) {
    assert.equal(tool._meta.ui.resourceUri, TODAY_BRIEF_RESOURCE_URI);
    assert.equal(tool._meta["ui/resourceUri"], TODAY_BRIEF_RESOURCE_URI);
  }
});

test("local initialize and preview tool expose mandatory evidence-first routing", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const initialized = await call(handle, "initialize", {}, 22);
  const listed = await call(handle, "tools/list", {}, 23);
  const preview = listed.result.tools.find((tool) => tool.name === LOCAL_PREVIEW_TOOL.name);
  assert.match(initialized.result.instructions, /MANDATORY ROUTING RULE/);
  assert.match(initialized.result.instructions, /must call evidra_preview_today/i);
  assert.match(preview.description, /MANDATORY FIRST STEP/);
  assert.match(preview.description, /Do not answer from memory/i);
});

test("the local server exposes the Today's Brief MCP App resource", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const listed = await call(handle, "resources/list", {}, 20);
  assert.equal(listed.result.resources[0].uri, TODAY_BRIEF_RESOURCE_URI);
  const read = await call(handle, "resources/read", { uri: TODAY_BRIEF_RESOURCE_URI }, 21);
  assert.equal(read.result.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(read.result.contents[0].text, /Pacevera Today's Brief/);
});

test("without an engine, decide_session still answers from the local export folder", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const response = await call(handle, "tools/call", {
    name: "decide_session",
    arguments: { date: "2026-07-22", scheduledSession: { focus: "Threshold Intervals", type: "run", durationMinutes: 60, intensity: "high" } }
  });
  assert.equal(response.error, undefined);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.provenance.evidenceSource, "provided");
  assert.ok(["keep", "adjust", "substitute", "defer", "advance"].includes(payload.decision.type));
});

test("without an engine, evidra_local_decide_today returns a clear error instead of throwing", async () => {
  const handle = createLocalMcpHandler({ localEvidenceDir: PRIVATE_DIR });
  const response = await call(handle, "tools/call", { name: LOCAL_DECISION_TOOL.name, arguments: { userId: "u1" } });
  assert.ok(response.error);
  assert.match(response.error.message, /unavailable/);
});
