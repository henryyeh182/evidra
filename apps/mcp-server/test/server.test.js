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
    "get_training_context"
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
