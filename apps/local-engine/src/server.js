// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { handleJsonRpcMessage as handleHostedJsonRpcMessage } from "../../mcp-server/src/server.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "../../mcp-server/src/jsonRpc.js";
import { jsonContent } from "../../mcp-server/src/content.js";

export const LOCAL_DECISION_TOOL = {
  name: "evidra_local_decide_today",
  title: "Decide Today's Local Session",
  description:
    "Read the user-controlled local plan and SQLite context, then decide what today's planned workout should become. No hosted MCP or provider token is involved.",
  inputSchema: {
    type: "object",
    properties: {
      userId: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD; defaults to the user's local day." },
      planId: { type: "string" },
      availableMinutes: { type: "number" },
      proposedSession: { type: "object" }
    },
    required: ["userId"]
  }
};

const LOCAL_INSTRUCTIONS =
  "This is Pacevera's user-controlled private engine. SQLite context and plans stay in the local environment; use evidra_local_decide_today for an existing local plan. Provider OAuth tokens are connector-bound and are never sent to MCP.";

export function createLocalMcpHandler({ engine } = {}) {
  if (!engine) throw new Error("createLocalMcpHandler requires a local engine.");

  return async function handleLocalMcpMessage(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed.ok) return parsed.error;
    const { id, method, params = {} } = parsed.message;
    const notification = id === undefined || id === null;

    if (method === "tools/list") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      return jsonRpcResult(id, {
        ...response.result,
        tools: [...response.result.tools, LOCAL_DECISION_TOOL]
      });
    }

    if (method === "initialize") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      return jsonRpcResult(id, {
        ...response.result,
        instructions: LOCAL_INSTRUCTIONS
      });
    }

    if (method === "tools/call" && params.name === LOCAL_DECISION_TOOL.name) {
      if (notification) return null;
      try {
        const result = await engine.decideToday(params.arguments || {});
        const { structuredContent, ...textOnly } = jsonContent(result);
        return jsonRpcResult(id, textOnly);
      } catch (error) {
        return jsonRpcError(id, -32000, error.message);
      }
    }

    return handleHostedJsonRpcMessage(rawMessage, { outcomeRepository: engine.repository, decisionRepository: engine.repository });
  };
}
