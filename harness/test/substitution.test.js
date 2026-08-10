// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";
import { runSubstitutionHarness } from "../substitution-runner.js";

test("exercise substitution decision harness holds across safe, filtered and empty paths", async () => {
  const results = await runSubstitutionHarness();
  assert.equal(results.length, 3);
});

test("exercise substitution reports an unknown movement as correctable", async () => {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "evidra_decide_exercise_substitution", arguments: { exerciseId: "interpretive dance" } }
    })
  );
  const payload = JSON.parse(response.result.content[0].text);
  assert.equal(response.result.isError, true);
  assert.equal(payload.error, "unknown_exercise");
  assert.ok(payload.shape.exerciseId);
});
