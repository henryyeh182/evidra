import test from "node:test";
import assert from "node:assert/strict";
import { handleJsonRpcMessage } from "../src/server.js";

test("MCP server initialize returns server capabilities", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {}
    })
  );

  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, "fitness-mcp");
  assert.deepEqual(response.result.capabilities, { tools: {} });
});

test("MCP server lists core fitness tools", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    })
  );

  const toolNames = response.result.tools.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "get_semantic_fitness_state",
    "recommend_today_workout",
    "get_training_context",
    "generate_training_plan",
    "get_training_plan",
    "list_training_plans",
    "preview_plan_change",
    "commit_plan_change"
  ]);
});

test("MCP server calls recommend_today_workout", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "recommend_today_workout",
        arguments: {
          userId: "user_henry_demo",
          date: "2026-07-23",
          includeStravaFixture: true
        }
      }
    })
  );

  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.userId, "user_henry_demo");
  assert.equal(payload.recommendedFocus, "Low-impact Zone 2 cardio + lower body mobility");
  assert.equal(payload.readinessScore, 67);
  assert.ok(payload.reasoning.some((line) => line.includes("Leg fatigue is elevated")));
});

async function callTool(id, name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
  );
  return JSON.parse(response.result.content[0].text);
}

test("MCP server runs the generate -> preview -> commit planning flow", async () => {
  const plan = await callTool(10, "generate_training_plan", {
    userId: "user_henry_demo",
    startDate: "2026-07-27",
    weeks: 4
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.weeks.length, 4);

  const preview = await callTool(11, "preview_plan_change", {
    planId: plan.id,
    changeRequest: { kind: "reduce_availability", weekdayAvailableMinutes: 25, weekIndexes: [1] }
  });
  assert.ok(preview.previewId);
  assert.ok(preview.diff.length > 0);

  const committed = await callTool(12, "commit_plan_change", { previewId: preview.previewId });
  assert.equal(committed.version, 2);
  assert.deepEqual(
    committed.versionHistory.map((entry) => entry.version),
    [1, 2]
  );

  const fetched = await callTool(13, "get_training_plan", { planId: plan.id });
  assert.equal(fetched.version, 2);
});

test("MCP server returns JSON-RPC error for unknown tools", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "missing_tool",
        arguments: {}
      }
    })
  );

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Unknown tool/);
});
