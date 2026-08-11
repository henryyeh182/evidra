import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleJsonRpcMessage } from "../src/server.js";
import {
  CONTINUITY_RETENTION,
  deleteAthleteRecord,
  exportAthleteRecord
} from "../src/stateStore.js";

test("the same athlete record survives a second MCP conversation without evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidra-continuity-"));
  const previous = process.env.EVIDRA_STATE_DIR;
  process.env.EVIDRA_STATE_DIR = directory;

  const evidence = {
    profile: { timezone: "Asia/Taipei", fitnessLevel: "intermediate" },
    healthMetrics: [
      {
        type: "sleep_duration_hours",
        value: 7.5,
        recordedAt: "2026-08-08T07:00:00+08:00",
        source: "manual"
      }
    ],
    workouts: [
      {
        startedAt: "2026-08-07T07:00:00+08:00",
        durationMinutes: 40,
        type: "run",
        trainingLoad: 40,
        source: "manual"
      }
    ]
  };
  const scheduledSession = {
    focus: "Easy Run",
    type: "run",
    durationMinutes: 30,
    intensity: "low",
    exercises: ["run"]
  };

  try {
    const first = await handleJsonRpcMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "evidra_decide_session", arguments: { evidence, scheduledSession, date: "2026-08-08" } }
      }),
      { identity: "athlete-shared-across-models", stateDirectory: directory }
    );
    const firstPayload = JSON.parse(first.result.content[0].text);
    assert.equal(firstPayload.provenance.continuity.storage, "server_durable_record");

    const second = await handleJsonRpcMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "evidra_decide_session", arguments: { scheduledSession, date: "2026-08-08" } }
      }),
      { identity: "athlete-shared-across-models", stateDirectory: directory }
    );
    const secondPayload = JSON.parse(second.result.content[0].text);
    assert.equal(secondPayload.provenance.evidenceSource, "server_durable_record");
    assert.equal(secondPayload.userId, "athlete-shared-across-models");
    assert.equal(secondPayload.signalCoverage.recovery.usable.includes("sleep"), true);
  } finally {
    if (previous === undefined) delete process.env.EVIDRA_STATE_DIR;
    else process.env.EVIDRA_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("continuity export and delete are owner-scoped and have explicit retention semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidra-continuity-lifecycle-"));
  const identity = "athlete-lifecycle";
  try {
    await handleJsonRpcMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "evidra_assess_fitness_state", arguments: {
        userId: identity,
        evidence: { profile: { timezone: "UTC" }, healthMetrics: [] }
      } }
    }), { identity, stateDirectory: directory });

    // The runtime uses EVIDRA_STATE_DIR; pass the same directory explicitly to
    // lifecycle operations so this test never touches repository data.
    const exported = await exportAthleteRecord(identity, { directory });
    assert.equal(CONTINUITY_RETENTION, "until_explicit_delete");
    assert.equal(exported.context.user.id, identity);
    assert.equal(await exportAthleteRecord("a-different-owner", { directory }), null);
    assert.equal(await deleteAthleteRecord(identity, { directory }), true);
    assert.equal(await exportAthleteRecord(identity, { directory }), null);
    assert.equal(await deleteAthleteRecord(identity, { directory }), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hosted request context never reads or writes continuity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidra-hosted-boundary-"));
  const identity = "hosted-subject";
  try {
    await handleJsonRpcMessage(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "evidra_assess_fitness_state", arguments: {
        userId: identity,
        evidence: { profile: { timezone: "UTC" }, healthMetrics: [] }
      } }
    }), { identity, hosted: true, stateDirectory: directory });
    assert.equal(await exportAthleteRecord(identity, { directory }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
