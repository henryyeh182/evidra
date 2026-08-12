// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createLocalMcpHandler } from "../src/server.js";
import { LocalPrivateEngine } from "../../../packages/private-engine/src/index.js";
import { SQLiteFitnessRepository } from "../../../packages/db/src/index.js";
import { generateTrainingPlan } from "../../../packages/planning/src/index.js";
import { clearDecisionRecordsForTests } from "../../mcp-server/src/decisionRecords.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("local MCP completes existing plan -> today's decision without hosted MCP", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    await repository.saveUserContext(context);
    const plan = generateTrainingPlan(context, { startDate: "2026-07-23", weeks: 1 });
    await repository.savePlan(plan);

    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository })
    });
    const initialized = await handle(JSON.stringify({
      jsonrpc: "2.0", id: 0, method: "initialize", params: {}
    }));
    assert.match(initialized.result.instructions, /user-controlled private engine/);
    const listed = await handle(JSON.stringify({
      jsonrpc: "2.0", id: 0.5, method: "tools/list", params: {}
    }));
    assert.ok(listed.result.tools.some((tool) => tool.name === "evidra_local_decide_today"));

    const response = await handle(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "evidra_local_decide_today",
        arguments: { userId: context.user.id, date: "2026-07-23" }
      }
    }));

    assert.equal(response.error, undefined);
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.provenance.hostedMcp, false);
    assert.equal(payload.planId, plan.id);
    assert.ok(payload.plannedWorkoutId);
    assert.equal(payload.date, "2026-07-23");
    assert.equal(payload.action.from.sessionId, payload.plannedWorkoutId);
    assert.ok(["keep", "adjust", "substitute", "defer", "advance"].includes(payload.decision.type));

    const persistedState = await repository.getSemanticFitnessState(context.user.id, "2026-07-23");
    assert.equal(persistedState.date, "2026-07-23");
  } finally {
    repository.close();
  }
});

test("local MCP persists submit_outcome in the user-controlled repository", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const handle = createLocalMcpHandler({
      engine: new LocalPrivateEngine({ repository })
    });
    const response = await handle(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "submit_outcome",
        arguments: {
          userId: "athlete-1",
          caseId: "decision_test_2",
          decisionId: "dec_test_2",
          outcome: { status: "completed" }
        }
      }
    }));
    const payload = JSON.parse(response.result.content[0].text);
    assert.equal(payload.persistence, "user_controlled_repository");
    assert.equal(payload.totalForCase, 1);
    const stored = await repository.listOutcomes("decision_test_2", "athlete-1");
    assert.equal(stored.length, 1);
    assert.equal(stored[0].outcome.status, "completed");
  } finally {
    repository.close();
  }
});

test("local MCP explains a decision after the in-process trace is cleared", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    await repository.saveUserContext(context);
    const handle = createLocalMcpHandler({ engine: new LocalPrivateEngine({ repository }) });
    const decisionResponse = await handle(JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "decide_session", arguments: {
        userId: context.user.id,
        evidence: { healthMetrics: [{ type: "sleep_duration_hours", value: 7, recordedAt: "2026-08-12T07:00:00Z", source: "manual", basis: "user_reported" }] },
        scheduledSession: { focus: "easy run", type: "run", durationMinutes: 30, intensity: "moderate" }
      } }
    }));
    const decision = JSON.parse(decisionResponse.result.content[0].text);
    clearDecisionRecordsForTests();
    const explanationResponse = await handle(JSON.stringify({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "explain_decision", arguments: { decisionId: decision.decisionId } }
    }));
    const explanation = JSON.parse(explanationResponse.result.content[0].text);
    assert.equal(explanation.decisionId, decision.decisionId);
    assert.equal(explanation.trace.versions.release, "0.5.0");
  } finally {
    repository.close();
    clearDecisionRecordsForTests();
  }
});
