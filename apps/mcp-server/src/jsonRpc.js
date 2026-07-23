export function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

export function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

export function parseJsonRpcMessage(rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage);
  } catch (error) {
    return {
      ok: false,
      error: jsonRpcError(null, -32700, "Parse error", { detail: error.message })
    };
  }

  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return {
      ok: false,
      error: jsonRpcError(message.id ?? null, -32600, "Invalid Request")
    };
  }

  return {
    ok: true,
    message
  };
}
