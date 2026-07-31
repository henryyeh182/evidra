export function jsonContent(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

/**
 * A tool that could not run, reported the way MCP means it to be reported.
 *
 * The protocol separates two failures: a JSON-RPC error means the call itself
 * was malformed, and a result carrying `isError` means the tool ran and could
 * not produce an answer. A caller that supplied no evidence is the second kind
 * — the request was well-formed, we simply have nothing to reason over. Sent as
 * a JSON-RPC error instead, it surfaces to the user as "Failed to call tool"
 * and the model cannot see what to do about it; sent this way, the model reads
 * the payload and can go and fetch what is missing.
 */
export function errorContent(payload) {
  return {
    ...jsonContent(payload),
    isError: true
  };
}
