// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createLocalMcpHandler } from "../src/server.js";
import { LocalPrivateEngine } from "../../../packages/private-engine/src/index.js";
import { SQLiteFitnessRepository } from "../../../packages/db/src/index.js";
import { generateTrainingPlan } from "../../../packages/planning/src/index.js";

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
