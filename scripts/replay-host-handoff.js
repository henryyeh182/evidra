// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Replay a captured third-party MCP result through the host-shaped Evidra call.
 *
 * This intentionally does not invent a vendor adapter: the capture must contain
 * both sides of the handoff observed in a real host session. The runner proves
 * that the host's resulting `evidence` is accepted by the real MCP server and
 * that the call is classified as caller-provided evidence.
 *
 * Capture shape:
 * {
 *   "capture": { "source": "...", "capturedAt": "...", "redacted": true },
 *   "thirdPartyResult": { "tool": "...", "result": {} },
 *   "hostCall": {
 *     "tool": "evidra_assess_fitness_state",
 *     "arguments": { "evidence": {}, "date": "YYYY-MM-DD" }
 *   }
 * }
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/replay-host-handoff.js <capture.json>");
  process.exitCode = 2;
} else {
  const capture = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  assertCaptureShape(capture);

  const { tool, arguments: args } = capture.hostCall;
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } })
  );

  if (response.error) throw new Error(`${tool} returned JSON-RPC error: ${response.error.message}`);

  const payload = JSON.parse(response.result.content[0].text);
  if (response.result.isError) {
    throw new Error(`${tool} rejected the captured host evidence: ${payload.problem || payload.error}`);
  }
  if (payload.provenance?.evidenceSource !== "provided") {
    throw new Error("The replay did not use caller-provided evidence.");
  }

  console.log(JSON.stringify({
    source: capture.capture.source,
    thirdPartyTool: capture.thirdPartyResult.tool,
    hostTool: tool,
    evidenceSource: payload.provenance.evidenceSource,
    result: "passed"
  }, null, 2));
}

function assertCaptureShape(capture) {
  if (!capture || typeof capture !== "object") throw new Error("Capture must be an object.");
  if (!capture.capture?.source || !capture.capture?.capturedAt || capture.capture.redacted !== true) {
    throw new Error("Capture metadata needs source, capturedAt, and redacted: true.");
  }
  if (!capture.thirdPartyResult?.tool || capture.thirdPartyResult.result === undefined) {
    throw new Error("Capture must include the third-party MCP tool and result.");
  }
  if (!capture.hostCall?.tool || !capture.hostCall.arguments?.evidence) {
    throw new Error("Capture must include a hostCall with evidence arguments.");
  }
}
