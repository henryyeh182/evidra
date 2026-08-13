// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createHttpServer } from "../apps/mcp-server/src/http.js";

// The 6 core decision tools this spike exercises, out of the 10 public tools
// the server currently advertises (v0.4.1+ dropped the evidra_ prefix from
// tools/list; the other 4 are the support and single-workout tools not needed
// to prove the ChatGPT scan/call path. `generate_workout` is a decision tool;
// the bounded support tools are explain_decision, get_evidence_coverage and
// submit_outcome.
const EXPECTED_TOOLS = [
  "assess_fitness_state",
  "decide_session",
  "decide_exercise_substitution",
  "generate_plan",
  "preview_adjust_plan",
  "commit_adjust_plan"
];

const endpointFromEnv = process.env.MCP_ENDPOINT || "";
const examplesDir = new URL("../examples/", import.meta.url);

function fail(message) {
  throw new Error(message);
}

async function postJsonRpc(endpoint, id, method, params = {}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(`${method} returned non-JSON HTTP ${response.status}: ${text.slice(0, 180)}`);
  }

  if (!response.ok) {
    fail(`${method} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (payload.error) {
    fail(`${method} returned JSON-RPC error: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function loadExample(name) {
  return JSON.parse(await readFile(new URL(name, examplesDir), "utf8"));
}

function structuredPayload(result, toolName) {
  const text = result?.content?.[0]?.text;
  if (!text) fail(`${toolName} returned no text content.`);
  const payload = JSON.parse(text);
  if (result.isError) {
    fail(`${toolName} returned tool error: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function withEndpoint(callback) {
  if (endpointFromEnv) {
    return callback(endpointFromEnv);
  }

  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  try {
    return await callback(endpoint);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

await withEndpoint(async (endpoint) => {
  const healthUrl = new URL("/health", endpoint);
  const health = await fetch(healthUrl);
  if (!health.ok) fail(`/health returned HTTP ${health.status}`);

  const initialize = await postJsonRpc(endpoint, 1, "initialize", {
    protocolVersion: "2025-06-18",
    clientInfo: { name: "evidra-chatgpt-feasibility-spike", version: "0.1.0" },
    capabilities: {}
  });
  if (initialize.serverInfo?.name !== "fitness-mcp") {
    fail(`initialize returned unexpected server name: ${initialize.serverInfo?.name}`);
  }

  const listed = await postJsonRpc(endpoint, 2, "tools/list");
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const missing = EXPECTED_TOOLS.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    fail(`tools/list missing expected core decision tools:\nmissing  ${missing.join(", ")}\nactual   ${toolNames.join(", ")}`);
  }
  const deprecatedAliases = toolNames.filter((name) => name.startsWith("evidra_"));
  if (deprecatedAliases.length > 0) {
    fail(`tools/list still advertises deprecated evidra_ prefixed names: ${deprecatedAliases.join(", ")}`);
  }

  const evidence = await loadExample("evidence-garmin-hard-day.json");
  const scheduledSession = {
    ...(await loadExample("scheduled-session.json")),
    focus: "Tempo Run",
    durationMinutes: 50
  };

  const decisionResult = await postJsonRpc(endpoint, 3, "tools/call", {
    name: "decide_session",
    arguments: {
      date: "2026-08-06",
      evidence,
      scheduledSession
    }
  });

  const decision = structuredPayload(decisionResult, "decide_session");
  if (decision.decision?.type !== "adjust") {
    fail(`expected decision.type adjust, got ${decision.decision?.type}`);
  }
  if (decision.confidence !== "high") {
    fail(`expected confidence high, got ${decision.confidence}`);
  }
  if (decision.decisionBasis?.governingRule?.ruleId !== "EVD-R-002") {
    fail(`expected governing rule EVD-R-002, got ${decision.decisionBasis?.governingRule?.ruleId}`);
  }

  console.log("ChatGPT MCP feasibility smoke passed.");
  console.log(`endpoint: ${endpoint}`);
  console.log(`tools: ${toolNames.length} (${toolNames.join(", ")})`);
  console.log(`decision: ${decision.decision.type}/${decision.decision.intent}`);
  console.log(`decisionBasis.governingRule: ${decision.decisionBasis.governingRule.ruleId}`);
});
