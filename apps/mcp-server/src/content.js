// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * A tool result, in both forms the protocol has.
 *
 * `structuredContent` is the payload itself, for a host that declared it wants
 * the object — it is what the tool's `outputSchema` describes, and a client can
 * validate it instead of trusting a paragraph. The text block stays because a
 * client that predates structured results would otherwise see an empty answer,
 * and it is serialized compactly: it is the same object twice, so the indenting
 * was paid for in every response for nothing.
 */
export function jsonContent(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload
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
  // Text only, deliberately: a tool that could not run has nothing that matches
  // its `outputSchema`, and handing a validating client an object that fails its
  // own declared schema turns a correctable refusal back into a broken call.
  const { structuredContent, ...result } = jsonContent(payload);
  return {
    ...result,
    isError: true
  };
}
