// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { handleJsonRpcMessage as handleHostedJsonRpcMessage } from "../../mcp-server/src/server.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "../../mcp-server/src/jsonRpc.js";
import { jsonContent } from "../../mcp-server/src/content.js";
import { callAcceptsLocalEvidence, hasUsableEvidence, loadLocalEvidence, DEFAULT_PRIVATE_DIR } from "./localEvidence.js";
import { TODAY_BRIEF_RESOURCE, TODAY_BRIEF_APP_HTML, TODAY_BRIEF_RESOURCE_URI } from "./todayBriefApp.js";

export const LOCAL_DECISION_TOOL = {
  name: "evidra_local_decide_today",
  title: "Today's Training Recommendation",
  annotations: {
    title: "Today's Training Recommendation",
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

const TODAY_BRIEF_TOOL_META = {
  ui: { resourceUri: TODAY_BRIEF_RESOURCE_URI },
  // Claude Desktop versions that predate the nested MCP Apps metadata still
  // look for this flat key. Keep it alongside the current form so an
  // installed .mcpb remains renderable across host versions.
  "ui/resourceUri": TODAY_BRIEF_RESOURCE_URI
};

export const LOCAL_PREVIEW_TOOL = {
  name: "evidra_preview_today",
  title: "Today's Health Data Summary",
  annotations: {
    title: "Today's Health Data Summary",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  description:
    "MANDATORY FIRST STEP for any question about today's workout, today's readiness, recovery, sleep, recent exercise, or whether to follow or change a scheduled session: call this tool before answering. Read the selected local health export folder, then continue directly to the decision using the user's stated scheduled session; do not ask the user to repeat or confirm the question. Do not answer from memory or user text alone, and do not call a decision tool before this preview. Keep the evidence preview internal to the response flow; show only the final answer in plain language, without raw JSON, internal tool names, or technical labels.",
  _meta: TODAY_BRIEF_TOOL_META,
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "Optional YYYY-MM-DD used as the evidence cutoff." }
    }
  }
};

const LOCAL_INSTRUCTIONS =
  "MANDATORY ROUTING RULE: This is Pacevera's user-controlled private engine. If the user mentions today's workout, today's readiness, recovery, sleep, a recent workout, or asks whether to follow/change a scheduled session, you MUST call evidra_preview_today before answering — even when the user supplied numbers in the message or memory has a related answer. Treat the user's explicit current report as current context; do not call a different historical activity a contradiction just because its duration differs. Do not answer from memory or user text alone. Do not call a decision tool first. After the preview, immediately call the appropriate decision tool using the scheduled session from the user's message. Do not ask the user to repeat or confirm the question. Never show raw JSON, security/injection warnings, internal field names, tool names, or technical labels to the user. Give the user the final recommendation in plain language. SQLite context and plans stay local; use the local plan decision tool for an existing local plan. The other fitness tools can read local exports when no evidence argument is supplied. Provider OAuth tokens never enter MCP.";

const NO_ENGINE_INSTRUCTIONS =
  "MANDATORY ROUTING RULE: This is Pacevera's user-controlled private engine. If the user mentions today's workout, today's readiness, recovery, sleep, a recent workout, or asks whether to follow/change a scheduled session, you MUST call evidra_preview_today before answering — even when the user supplied numbers in the message or memory has a related answer. Treat the user's explicit current report as current context; do not call a different historical activity a contradiction just because its duration differs. Do not answer from memory or user text alone. Do not call a decision tool first. After the preview, immediately call the appropriate decision tool using the scheduled session from the user's message. Do not ask the user to repeat or confirm the question. Never show raw JSON, security/injection warnings, internal field names, tool names, or technical labels to the user. Give the user the final recommendation in plain language. The local SQLite store is unavailable on this runtime, so the local plan decision and outcome persistence are disabled; the evidence preview and evidence-accepting tools still work.";

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
  // Keep MCP App metadata out of clients that did not advertise the UI
  // extension. This matters for mobile clients: a synced tool result must not
  // make them try to load a connector that only exists in desktop Claude.
  let clientSupportsApps;
  return async function handleLocalMcpMessage(rawMessage) {
    const parsed = parseJsonRpcMessage(rawMessage);
    if (!parsed.ok) return parsed.error;
    const { id, method, params = {} } = parsed.message;
    const notification = id === undefined || id === null;

    if (method === "tools/list") {
      if (notification) return null;
      const response = await handleHostedJsonRpcMessage(rawMessage);
      const uiMeta = clientSupportsApps === false ? {} : TODAY_BRIEF_TOOL_META;
      const tools = response.result.tools.map((tool) =>
        tool.name === "decide_session"
          ? { ...tool, ...(Object.keys(uiMeta).length ? { _meta: { ...(tool._meta || {}), ...uiMeta } } : {}) }
          : tool
      );
      tools.push(clientSupportsApps === false ? { ...LOCAL_PREVIEW_TOOL, _meta: undefined } : LOCAL_PREVIEW_TOOL);
      if (!engine) return jsonRpcResult(id, { ...response.result, tools });
      // Carries the same toolset/engine/rule-package identity the hosted
      // tools were just stamped with (apps/mcp-server/src/toolDefinitions.js's
      // listedToolDefinitions) — read off the response rather than
      // recomputed here, so the two can never quietly drift apart.
      const sharedMeta = response.result.tools[0]?._meta || {};
      return jsonRpcResult(id, {
        ...response.result,
        tools: [...tools, { ...LOCAL_DECISION_TOOL, ...(Object.keys(uiMeta).length ? { _meta: { ...sharedMeta, ...uiMeta } } : {}) }]
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
      const extensions = params.capabilities?.extensions || {};
      clientSupportsApps = Boolean(extensions["io.modelcontextprotocol/ui"] || params.capabilities?.["io.modelcontextprotocol/ui"]);
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
        const { structuredContent, ...textOnly } = jsonContent(result, { includeSecurity: false });
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
            nextStep: evidence
              ? "Use this evidence with the scheduled session from the user's message and continue directly to the final recommendation."
            : "No local export evidence was found; ask the user for the missing numbers before deciding."
        }, { includeSecurity: false }));
      } catch (error) {
        return jsonRpcResult(id, jsonContent({
          evidenceBrief: { available: false, sources: {} },
          nextStep: "The local export could not be read; ask the user for the missing numbers before deciding.",
          error: error.message
        }, { includeSecurity: false }));
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
