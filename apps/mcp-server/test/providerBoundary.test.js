// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { findProviderTokenField } from "../src/providerBoundary.js";
import { handleJsonRpcMessage } from "../src/server.js";

test("provider token fields are identified without inspecting their values", () => {
  assert.deepEqual(
    findProviderTokenField({ evidence: { connector: { refresh_token: "secret" } } }),
    ["evidence", "connector", "refresh_token"]
  );
  assert.equal(findProviderTokenField({ evidence: { profile: { name: "Athlete" } } }), null);
});

test("hosted MCP rejects provider tokens and does not reflect the secret", async () => {
  const secret = "provider-refresh-secret-123";
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "evidra_assess_fitness_state",
      arguments: {
        evidence: {
          connector: { provider: "garmin", refreshToken: secret }
        }
      }
    }
  }));

  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Provider tokens are not accepted/);
  assert.equal(JSON.stringify(response).includes(secret), false);
});
