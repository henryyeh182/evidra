// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createLocalMcpHandler } from "../src/server.js";
import { DEFAULT_PRIVATE_DIR, normalizePrivateDir } from "../src/localEvidence.js";
import { LocalPrivateEngine } from "../../../packages/private-engine/src/index.js";
import { SQLiteFitnessRepository } from "../../../packages/db/src/index.js";

// Laid out under the real default folder convention (export_apple_health,
// export_garmin/DI_CONNECT, export_strava, export_google_health/raw) so this
// exercises the same path loadLocalEvidence's default takes, not just the
// per-source overrides packages/connectors/test already covers.
const PRIVATE_DIR = fileURLToPath(new URL("../../../data/fixtures/pacevera-private", import.meta.url));

test("an unexpanded or relative private-data env value falls back to the home-directory default", () => {
  assert.equal(normalizePrivateDir("${HOME}/Pacevera"), DEFAULT_PRIVATE_DIR);
  assert.equal(normalizePrivateDir("Pacevera"), DEFAULT_PRIVATE_DIR);
  assert.equal(normalizePrivateDir(undefined), DEFAULT_PRIVATE_DIR);
  assert.equal(normalizePrivateDir(PRIVATE_DIR), PRIVATE_DIR);
});

async function callTool(handle, name, args, id = 1) {
  return handle(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }));
}

test("decide_session with no evidence argument answers from the local export folder instead of failing", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository }),
      localEvidenceDir: PRIVATE_DIR
    });

    const response = await callTool(handle, "decide_session", {
      date: "2026-07-22",
      scheduledSession: { focus: "Threshold Intervals", type: "run", durationMinutes: 60, intensity: "high" }
    });

    assert.equal(response.error, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.provenance.evidenceSource, "provided");
    assert.match(payload.provenance.stateId, /^state_/);
    assert.equal(payload.todayBrief.evidence.stateId, payload.provenance.stateId);
    assert.equal(payload.todayBrief.date, "2026-07-22");
    assert.ok(["keep", "adjust", "substitute", "defer", "advance"].includes(payload.decision.type));
    assert.ok(payload.action.from);
    assert.ok(payload.signalCoverage);
  } finally {
    repository.close();
  }
});

test("evidence the caller explicitly supplies is never overridden by local files", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository }),
      localEvidenceDir: PRIVATE_DIR
    });

    const suppliedEvidence = {
      healthMetrics: [
        { type: "sleep_duration_hours", value: 9, recordedAt: "2026-08-12T07:00:00Z", source: "manual" }
      ]
    };
    const response = await callTool(handle, "assess_fitness_state", { evidence: suppliedEvidence, date: "2026-08-12" });
    assert.equal(response.error, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    // If the local fixture had leaked in, coverage would show far more than
    // the single sleep reading the caller actually supplied.
    assert.deepEqual(payload.signalCoverage.recovery.usable, ["sleep"]);
  } finally {
    repository.close();
  }
});

test("a tool with no evidence field (decide_exercise_substitution) is never intercepted", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository }),
      localEvidenceDir: PRIVATE_DIR
    });
    const response = await callTool(handle, "decide_exercise_substitution", { exerciseId: "not_a_real_exercise" });
    // Its own contract's error, not evidence_required — proves the local
    // evidence branch never touched this call.
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(response.result.isError, true);
    assert.equal(payload.error, "unknown_exercise");
  } finally {
    repository.close();
  }
});

test("an empty/unset local export folder falls through to the tool's normal evidence-required response", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository }),
      localEvidenceDir: fileURLToPath(new URL("../../../data/fixtures/does-not-exist", import.meta.url))
    });
    const response = await callTool(handle, "decide_session", {
      scheduledSession: { focus: "Easy run", type: "run", durationMinutes: 30, intensity: "low" }
    });
    // No local data and no supplied evidence: the hosted handler's own
    // "evidence required" behavior, unmodified — not a fabricated decision.
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(response.result.isError, true);
    assert.equal(payload.error, "evidence_required");
  } finally {
    repository.close();
  }
});
