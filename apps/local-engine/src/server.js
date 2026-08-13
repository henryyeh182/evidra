// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { handleJsonRpcMessage as handleHostedJsonRpcMessage } from "../../mcp-server/src/server.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "../../mcp-server/src/jsonRpc.js";
import { jsonContent } from "../../mcp-server/src/content.js";
import { callAcceptsLocalEvidence, hasUsableEvidence, loadLocalEvidence, DEFAULT_PRIVATE_DIR } from "./localEvidence.js";

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
  "This is Pacevera's user-controlled private engine. SQLite context and plans stay in the local environment; use evidra_local_decide_today for an existing local plan. assess_fitness_state, decide_session, generate_plan and generate_workout read the user's local export folder automatically when no `evidence` argument is supplied — pass `evidence` yourself only to report something not yet exported. Provider OAuth tokens are connector-bound and are never sent to MCP.";

export function createLocalMcpHandler({ engine, localEvidenceDir = DEFAULT_PRIVATE_DIR } = {}) {
  if (!engine) throw new Error("createLocalMcpHandler requires a local engine.");

  return async function handleLocalMcpMessage(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed.ok) return parsed.error;
    const { id, method, params = {} } = parsed.message;
    const notification = id === undefined || id === null;

    if (method === "tools/list") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      // Carries the same toolset/engine/rule-package identity the hosted
      // tools were just stamped with (apps/mcp-server/src/toolDefinitions.js's
      // listedToolDefinitions) — read off the response rather than
      // recomputed here, so the two can never quietly drift apart.
      const sharedMeta = response.result.tools[0]?._meta || {};
      return jsonRpcResult(id, {
        ...response.result,
        tools: [...response.result.tools, { ...LOCAL_DECISION_TOOL, _meta: sharedMeta }]
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

    if (
      method === "tools/call" &&
      callAcceptsLocalEvidence(params.name) &&
      !hasUsableEvidence(params.arguments?.evidence)
    ) {
      // A caller-supplied `evidence` (even a single data point) is never
      // overridden — this only fills a gap the caller left, from the same
      // local machine the export folder lives on. Failure here (unreadable
      // folder, malformed export) falls through to the tool's normal
      // "evidence required" response rather than breaking the call — a local
      // read that did not work is the same as one that was never attempted.
      let local;
      try {
        local = await loadLocalEvidence({ baseDir: localEvidenceDir, asOf: params.arguments?.date });
      } catch {
        local = { evidence: null };
      }
      if (local.evidence) {
        const augmented = {
          ...parsed.message,
          params: { ...params, arguments: { ...(params.arguments || {}), evidence: local.evidence } }
        };
        return handleHostedJsonRpcMessage(JSON.stringify(augmented), {
          outcomeRepository: engine.repository,
          decisionRepository: engine.repository
        });
      }
    }

    return handleHostedJsonRpcMessage(rawMessage, { outcomeRepository: engine.repository, decisionRepository: engine.repository });
  };
}
