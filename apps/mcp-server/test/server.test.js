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
    "assess_fitness_state",
    "decide_session",
    "decide_exercise_substitution",
    "generate_plan",
    "preview_adjust_plan",
    "commit_adjust_plan"
  ]);
  // Every exposed tool must be a decision or the substrate one operates on.
  assert.ok(toolNames.length <= 10, `tool surface grew to ${toolNames.length}`);
  // Content endpoints are hidden from discovery but stay callable for one release.
  for (const retired of ["search_exercises", "get_exercise", "search_workouts", "get_workout",
                         "get_user_profile", "get_training_history", "get_plan", "list_plans",
                         "recommend_workout", "get_training_context"]) {
    assert.ok(!toolNames.includes(retired), `${retired} should no longer be advertised`);
  }
});

test("MCP server calls assess_fitness_state", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "assess_fitness_state",
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
  assert.equal(payload.provenance.evidenceSource, "demo_fallback");
});

test("MCP server still routes a deprecated tool alias to its canonical handler", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "recommend_today_workout", // deprecated alias for recommend_workout
        arguments: { userId: "user_henry_demo", date: "2026-07-23" }
      }
    })
  );

  assert.equal(response.error, undefined);
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(payload.userId, "user_henry_demo");
  assert.ok(payload.recommendedFocus.length > 0);
});

async function callTool(id, name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
  );
  return JSON.parse(response.result.content[0].text);
}

test("MCP server runs the generate -> preview -> commit planning flow", async () => {
  const plan = await callTool(10, "generate_plan", {
    userId: "user_henry_demo",
    startDate: "2026-07-27",
    weeks: 4
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.weeks.length, 4);

  const preview = await callTool(11, "preview_adjust_plan", {
    planId: plan.id,
    changeRequest: { kind: "reduce_availability", weekdayAvailableMinutes: 25, weekIndexes: [1] }
  });
  assert.ok(preview.previewId);
  assert.ok(preview.diff.length > 0);

  const committed = await callTool(12, "commit_adjust_plan", { previewId: preview.previewId });
  assert.equal(committed.version, 2);
  assert.deepEqual(
    committed.versionHistory.map((entry) => entry.version),
    [1, 2]
  );

  const fetched = await callTool(13, "get_plan", { planId: plan.id });
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

test("a notification is never answered", async () => {
  // Real clients send notifications/initialized right after the handshake.
  // Replying to something with no id is a JSON-RPC violation.
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
  );
  assert.equal(response, null);
});

test("initialize echoes a protocol version the client asked for", async () => {
  const negotiate = async (protocolVersion) => {
    const response = await handleJsonRpcMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion } })
    );
    return response.result.protocolVersion;
  };

  assert.equal(await negotiate("2025-06-18"), "2025-06-18");
  assert.equal(await negotiate("2024-11-05"), "2024-11-05");
  // An unknown version falls back to our newest rather than failing.
  assert.equal(await negotiate("1999-01-01"), "2025-06-18");
});

test("ping answers with an empty result", async () => {
  const response = await handleJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }));
  assert.deepEqual(response.result, {});
});
