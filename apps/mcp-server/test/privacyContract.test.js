// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redactForLog, redactText, requestLogRecord } from "../src/privacy.js";
import { createHttpServer } from "../src/http.js";

const root = join(import.meta.dirname, "../../..");
const contract = JSON.parse(readFileSync(join(root, "schemas/privacy/deployment-modes.json"), "utf8"));

test("the privacy manifest defines exactly the three deployment modes", () => {
  assert.deepEqual(contract.modes.map((mode) => mode.id), [
    "local-desktop",
    "user-controlled-private",
    "hosted-remote"
  ]);
  for (const mode of contract.modes) {
    for (const section of ["dataFlow", "storage", "tokens", "logging", "deletion"]) {
      assert.ok(mode[section], `${mode.id} is missing ${section}`);
    }
  }
  assert.equal(contract.modes.find((mode) => mode.id === "hosted-remote").status, "no-go");
  assert.equal(contract.modes.find((mode) => mode.id === "local-desktop").storage.durableByPacevera, false);
});

test("redaction removes credentials, identity, and health payloads", () => {
  const value = redactForLog({
    method: "POST",
    path: "/mcp",
    authorization: "Bearer super-secret",
    userId: "athlete-7",
    arguments: { evidence: { healthMetrics: [{ value: 44 }]} },
    error: "Bearer another-secret"
  });
  assert.deepEqual(value, {
    method: "POST",
    path: "/mcp",
    authorization: "[REDACTED]",
    userId: "[REDACTED]",
    arguments: "[REDACTED]",
    error: "Bearer [REDACTED]"
  });
  assert.equal(redactText("https://x.test/?access_token=abc"), "https://x.test/?access_token=[REDACTED]");
});

test("request log records never inspect the request body or authorization header", () => {
  const record = requestLogRecord({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: "Bearer secret",
      "content-length": "123"
    }
  }, { status: 200, durationMs: 4 });
  assert.deepEqual(record, {
    method: "POST",
    path: "/mcp",
    status: 200,
    durationMs: 4,
    contentLength: "123"
  });
  assert.equal(JSON.stringify(record).includes("secret"), false);
});

test("HTTP logger receives only safe metadata for an Evidence request", async () => {
  const records = [];
  const server = createHttpServer({ logger: (record) => records.push(record) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer do-not-log", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "assess_fitness_state", arguments: { userId: "athlete-7", evidence: { healthMetrics: [{ value: 44 }] } } }
      })
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0]).sort(), ["contentLength", "durationMs", "method", "path", "status"]);
    assert.equal(JSON.stringify(records[0]).includes("do-not-log"), false);
    assert.equal(JSON.stringify(records[0]).includes("athlete-7"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
