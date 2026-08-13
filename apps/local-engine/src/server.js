// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { handleJsonRpcMessage as handleHostedJsonRpcMessage } from "../../mcp-server/src/server.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "../../mcp-server/src/jsonRpc.js";
import { jsonContent } from "../../mcp-server/src/content.js";
import { callAcceptsLocalEvidence, hasUsableEvidence, loadLocalEvidence, DEFAULT_PRIVATE_DIR } from "./localEvidence.js";
import { TODAY_BRIEF_RESOURCE, TODAY_BRIEF_APP_HTML, TODAY_BRIEF_RESOURCE_URI } from "./todayBriefApp.js";

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

export const LOCAL_PREVIEW_TOOL = {
  name: "evidra_preview_today",
  title: "Preview Today's Evidence",
  annotations: {
    title: "Preview Today's Evidence",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  description:
    "Read the selected local health export folder and return the evidence preview only. This must be shown to the user before deciding today's workout.",
  _meta: { ui: { resourceUri: TODAY_BRIEF_RESOURCE_URI } },
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "Optional YYYY-MM-DD used as the evidence cutoff." }
    }
  }
};

const LOCAL_INSTRUCTIONS =
  "This is Pacevera's user-controlled private engine. For a question about today's workout using local health exports, first call evidra_preview_today, show the returned evidenceBrief and sources to the user, and wait for the user's confirmation before calling decide_session or another decision tool. Do not silently chain the preview and decision in one turn. SQLite context and plans stay in the local environment; use evidra_local_decide_today for an existing local plan. assess_fitness_state, decide_session, generate_plan and generate_workout can read the user's local export folder automatically when no `evidence` argument is supplied. Provider OAuth tokens are connector-bound and are never sent to MCP.";

const NO_ENGINE_INSTRUCTIONS =
  "This is Pacevera's user-controlled private engine. For a question about today's workout using local health exports, first call evidra_preview_today, show the returned evidenceBrief and sources to the user, and wait for the user's confirmation before calling decide_session or another decision tool. Do not silently chain the preview and decision in one turn. The local SQLite store is unavailable on this runtime, so evidra_local_decide_today and outcome/decision-trace persistence are disabled; the evidence preview and four evidence-accepting tools still work.";

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
      const tools = response.result.tools.map((tool) =>
        tool.name === "decide_session"
          ? { ...tool, _meta: { ...(tool._meta || {}), ui: { resourceUri: TODAY_BRIEF_RESOURCE_URI } } }
          : tool
      );
      tools.push(LOCAL_PREVIEW_TOOL);
      if (!engine) return jsonRpcResult(id, { ...response.result, tools });
      // Carries the same toolset/engine/rule-package identity the hosted
      // tools were just stamped with (apps/mcp-server/src/toolDefinitions.js's
      // listedToolDefinitions) — read off the response rather than
      // recomputed here, so the two can never quietly drift apart.
      const sharedMeta = response.result.tools[0]?._meta || {};
      return jsonRpcResult(id, {
        ...response.result,
        tools: [...tools, { ...LOCAL_DECISION_TOOL, _meta: sharedMeta }]
      });
    }

    if (method === "resources/list") {
      if (notification) return null;
      return jsonRpcResult(id, { resources: [TODAY_BRIEF_RESOURCE] });
    }

    if (method === "resources/read") {
      if (notification) return null;
      if (params.uri !== TODAY_BRIEF_RESOURCE_URI) {
        return jsonRpcError(id, -32602, `Unknown resource: ${params.uri}`);
      }
      return jsonRpcResult(id, {
        contents: [{
          uri: TODAY_BRIEF_RESOURCE_URI,
          mimeType: TODAY_BRIEF_RESOURCE.mimeType,
          text: TODAY_BRIEF_APP_HTML,
          _meta: TODAY_BRIEF_RESOURCE._meta
        }]
      });
    }

    if (method === "initialize") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      return jsonRpcResult(id, {
        ...response.result,
        capabilities: { ...response.result.capabilities, resources: { subscribe: false, listChanged: false } },
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

    if (method === "tools/call" && params.name === LOCAL_PREVIEW_TOOL.name) {
      if (notification) return null;
      try {
        const local = await loadLocalEvidence({ baseDir: localEvidenceDir, asOf: params.arguments?.date });
        const evidence = local.evidence;
        return jsonRpcResult(id, jsonContent({
          evidenceBrief: {
            date: params.arguments?.date || new Date().toISOString().slice(0, 10),
            available: Boolean(evidence),
            sources: local.sources,
            signalCounts: evidence
              ? {
                workouts: evidence.workouts?.length || 0,
                healthMetrics: evidence.healthMetrics?.length || 0,
                vendorAssessments: evidence.vendorAssessments?.length || 0
              }
              : null
          },
          evidence,
          nextStep: evidence
            ? "Show this evidence to the user and wait for confirmation before calling a decision tool."
            : "No local export evidence was found; ask the user for the missing numbers before deciding."
        }));
      } catch (error) {
        return jsonRpcResult(id, jsonContent({
          evidenceBrief: { available: false, sources: {} },
          evidence: null,
          nextStep: "The local export could not be read; ask the user for the missing numbers before deciding.",
          error: error.message
        }));
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
