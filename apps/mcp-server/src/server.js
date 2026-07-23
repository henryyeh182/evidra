import { getToolDefinition, toolDefinitions } from "./toolDefinitions.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "./jsonRpc.js";
import { toolHandlers } from "./toolHandlers.js";

export async function handleJsonRpcMessage(rawMessage) {
  const parsed = parseJsonRpcMessage(rawMessage);
  if (!parsed.ok) {
    return parsed.error;
  }

  const { id, method, params = {} } = parsed.message;

  try {
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        serverInfo: {
          name: "fitness-mcp",
          version: "0.1.0"
        },
        capabilities: {
          tools: {}
        }
      });
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, {
        tools: toolDefinitions
      });
    }

    if (method === "tools/call") {
      const toolName = params.name;
      const tool = getToolDefinition(toolName);
      const handler = toolHandlers[toolName];

      if (!tool || !handler) {
        return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
      }

      const result = await handler(params.arguments || {});
      return jsonRpcResult(id, result);
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return jsonRpcError(id, -32000, error.message);
  }
}
