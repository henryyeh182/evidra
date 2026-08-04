import { readFileSync } from "node:fs";

import { getToolDefinition, listedToolDefinitions, resolveToolName } from "./toolDefinitions.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "./jsonRpc.js";
import { toolHandlers } from "./toolHandlers.js";

/**
 * The version a client is told has to be the version that shipped.
 *
 * Written out here as a literal it drifted: clients were told 0.1.0 while the
 * package, the manifest and the released bundle were all 0.1.1, and nothing
 * compared them. Read from the package manifest instead, which cannot drift
 * from itself. No new dependency on the bundle's contents either — package.json
 * has to travel inside it regardless, because `type: module` is what lets these
 * imports resolve at all.
 */
const { version: SERVER_VERSION } = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
);

// Newest first: index 0 is what we offer when the client asks for something
// we do not recognise.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export async function handleJsonRpcMessage(rawMessage) {
  const parsed = parseJsonRpcMessage(rawMessage);
  if (!parsed.ok) {
    return parsed.error;
  }

  const { id, method, params = {} } = parsed.message;

  // A JSON-RPC notification carries no id and must not be answered. Every real
  // MCP client sends `notifications/initialized` right after the handshake, so
  // replying here breaks the very first exchange of a session.
  const isNotification = id === undefined || id === null;
  if (isNotification) {
    return null;
  }

  try {
    if (method === "initialize") {
      // Echo the client's protocol version when we support it, so a newer
      // client is not silently downgraded; otherwise offer our latest.
      const requested = params.protocolVersion;
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return jsonRpcResult(id, {
        protocolVersion: negotiated,
        serverInfo: {
          name: "fitness-mcp",
          version: SERVER_VERSION
        },
        capabilities: {
          tools: {}
        }
      });
    }

    // Keepalive: the spec defines ping as an empty-result round trip.
    if (method === "ping") {
      return jsonRpcResult(id, {});
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, {
        tools: listedToolDefinitions()
      });
    }

    if (method === "tools/call") {
      const toolName = resolveToolName(params.name);
      const tool = getToolDefinition(toolName);
      const handler = toolHandlers[toolName];

      if (!tool || !handler) {
        return jsonRpcError(id, -32602, `Unknown tool: ${params.name}`);
      }

      const result = await handler(params.arguments || {});
      return jsonRpcResult(id, result);
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return jsonRpcError(id, -32000, error.message);
  }
}
