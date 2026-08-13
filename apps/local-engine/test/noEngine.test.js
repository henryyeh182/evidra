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
  assert.equal(payload.nextStep.includes("wait for confirmation"), true);
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
