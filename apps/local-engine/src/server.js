// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { handleJsonRpcMessage as handleHostedJsonRpcMessage } from "../../mcp-server/src/server.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "../../mcp-server/src/jsonRpc.js";
import { jsonContent } from "../../mcp-server/src/content.js";
import { callAcceptsLocalEvidence, hasUsableEvidence, loadLocalEvidence, DEFAULT_PRIVATE_DIR } from "./localEvidence.js";

export const LOCAL_DECISION_TOOL = {
  name: "evidra_local_decide_today",
  title: "Decide Today's Local Session",
  annotations: {
    title: "Decide Today's Local Session",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
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

const NO_ENGINE_INSTRUCTIONS =
  "This is Pacevera's user-controlled private engine. The local SQLite store is unavailable on this runtime (see the error this process printed to stderr at startup), so evidra_local_decide_today and outcome/decision-trace persistence are disabled — assess_fitness_state, decide_session, generate_plan and generate_workout still work and still read the user's local export folder automatically when no `evidence` argument is supplied.";

/**
 * `engine` is optional: `packages/db`'s `node:sqlite` dependency does not
 * exist before Node 22.5 (still experimental there), and this runtime's
 * actual Node version is outside this process's control — a caller that
 * failed to construct a repository passes `engine: undefined` here rather
 * than letting that failure crash the whole server. Only
 * evidra_local_decide_today and outcome/decision-trace persistence need
 * `engine`; the four evidence-accepting tools (via localEvidence.js) do not.
 */
export function createLocalMcpHandler({ engine, localEvidenceDir = DEFAULT_PRIVATE_DIR } = {}) {
  return async function handleLocalMcpMessage(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed.ok) return parsed.error;
    const { id, method, params = {} } = parsed.message;
    const notification = id === undefined || id === null;

    if (method === "tools/list") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      if (!engine) return jsonRpcResult(id, response.result);
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
        instructions: engine ? LOCAL_INSTRUCTIONS : NO_ENGINE_INSTRUCTIONS
      });
    }

    if (method === "tools/call" && params.name === LOCAL_DECISION_TOOL.name) {
      if (notification) return null;
      if (!engine) {
        return jsonRpcError(id, -32000, "evidra_local_decide_today is unavailable: this runtime has no local SQLite store (see startup stderr).");
      }
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
          outcomeRepository: engine?.repository,
          decisionRepository: engine?.repository
        });
      }
    }

    return handleHostedJsonRpcMessage(rawMessage, { outcomeRepository: engine?.repository, decisionRepository: engine?.repository });
  };
}
