// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

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

/**
 * The static text a host loads before it has called anything, and its ceiling.
 *
 * Unlike the frame ceiling, this one is not a budget we chose. Claude Code
 * documents it: "Claude Code truncates tool descriptions and server
 * instructions at 2KB each"
 * (https://code.claude.com/docs/en/mcp, MCP output limits and warnings).
 *
 * It went unenforced and the instructions reached 3539 bytes, so 1491 bytes had
 * never reached a model — including the whole of the provenance guidance, which
 * is the part of this text most costly to lose. Nothing failed, because nothing
 * was looking. That is the argument for the assertion rather than for
 * remembering to check: the truncation is silent at both ends.
 *
 * Note where the pressure comes from. Roughly a third of the instructions is
 * interpolated from `session-rules.json` — the two policy descriptions — so
 * editing the rule library can push this over without anyone touching
 * server.js. That is the case this test exists to catch.
 */
const CLIENT_TEXT_CEILING = 2048;

test("the instructions a host loads survive the client's 2KB truncation", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  );
  const bytes = Buffer.byteLength(response.result.instructions, "utf8");

  assert.ok(
    bytes <= CLIENT_TEXT_CEILING,
    `server instructions are ${bytes} bytes and are truncated at ${CLIENT_TEXT_CEILING}. ` +
      `The last ${bytes - CLIENT_TEXT_CEILING} bytes would never reach a model. Cut the text, ` +
      `or move reference material into the payload that needs it — do not simply reorder, ` +
      `which moves the loss rather than removing it.`
  );
});

test("every tool description survives the client's 2KB truncation", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  );

  for (const tool of response.result.tools) {
    const bytes = Buffer.byteLength(tool.description ?? "", "utf8");
    assert.ok(
      bytes <= CLIENT_TEXT_CEILING,
      `${tool.name} has a ${bytes}-byte description and is truncated at ${CLIENT_TEXT_CEILING}`
    );
  }
});

// The provenance paragraphs are why this text was reordered. A later edit that
// pushes them past the cut point restores the original failure while leaving
// the byte-count assertions green, so their position is pinned too.
test("the provenance guidance sits inside the first 2KB, not at the end", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  );
  const head = Buffer.from(response.result.instructions, "utf8")
    .subarray(0, CLIENT_TEXT_CEILING)
    .toString();

  for (const claim of ["internal_composite", "external_metric", "decisionBasis", "contested"]) {
    assert.ok(head.includes(claim), `"${claim}" falls outside the bytes a host actually receives`);
  }
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
    "evidra_assess_fitness_state",
    "evidra_decide_session",
    "evidra_decide_exercise_substitution",
    "evidra_generate_plan",
    "evidra_preview_adjust_plan",
    "evidra_commit_adjust_plan"
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

test("MCP server includes release identity in the advertised toolset", async () => {
  const init = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  );
  const listed = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  );
  const version = init.result.serverInfo.version;

  assert.ok(version);
  for (const tool of listed.result.tools) {
    assert.equal(
      tool._meta?.["io.github.henryyeh182/evidra/toolsetVersion"],
      version,
      `${tool.name} does not carry the release version in tools/list`
    );
  }
});

test("MCP server calls evidra_assess_fitness_state", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "evidra_assess_fitness_state",
        arguments: {
          useDemoSeed: true,
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
  assert.equal(payload.provenance.evidenceSource, "demo_seed");
});

test("MCP server still routes a deprecated tool alias to its canonical handler", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "recommend_today_workout", // deprecated alias for recommend_workout
        arguments: { useDemoSeed: true, date: "2026-07-23" }
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
  const plan = await callTool(10, "evidra_generate_plan", {
    useDemoSeed: true,
    startDate: "2026-07-27",
    weeks: 4
  });
  assert.equal(plan.version, 1);
  assert.equal(plan.weeks.length, 4);

  const preview = await callTool(11, "evidra_preview_adjust_plan", {
    plan,
    changeRequest: { kind: "reduce_availability", weekdayAvailableMinutes: 25, weekIndexes: [1] }
  });
  assert.ok(preview.previewId);
  assert.ok(preview.diff.length > 0);

  const committed = await callTool(12, "evidra_commit_adjust_plan", { plan, preview: preview.patch });
  assert.equal(committed.version, 2);
  assert.equal(committed.plan.constraints.weekdayAvailableMinutes, 25);
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
