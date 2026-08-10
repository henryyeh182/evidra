// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import { createConfiguredServer, createHttpServer } from "../src/http.js";
import { verifyJwtSignature } from "../src/oauth.js";

const RESOURCE = "http://127.0.0.1/mcp";
const ISSUER = "https://auth.synthetic.example";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-1", alg: "RS256", use: "sig" };

function token(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic-1" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: RESOURCE,
    exp: Math.floor(Date.now() / 1000) + 600,
    scope: "fitness.decide",
    ...overrides
  })).toString("base64url");
  const input = `${header}.${claims}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}

async function withServer(run) {
  const server = createHttpServer({
    endpoint: "/mcp",
    oauth: {
      resource: RESOURCE,
      authorizationServers: [ISSUER],
      issuers: [ISSUER],
      scopes: ["fitness.decide"],
      requiredScopes: ["fitness.decide"],
      verify: async (value) => verifyJwtSignature(value, { jwks: [jwk], algorithms: ["RS256"] })
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("remote resource metadata and WWW-Authenticate expose the authorization boundary", async () => {
  await withServer(async (base) => {
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status, 200);
    assert.deepEqual((await metadata.json()).authorization_servers, [ISSUER]);

    const response = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /resource_metadata=/);
    assert.match(response.headers.get("www-authenticate"), /invalid_request/);
  });
});

test("the local remote integration rejects forged, expired, wrong-audience and under-scoped tokens", async () => {
  await withServer(async (base) => {
    const cases = [
      { name: "forged signature", value: `${token().slice(0, -2)}aa`, status: 401 },
      { name: "expired", value: token({ exp: Math.floor(Date.now() / 1000) - 600 }), status: 401 },
      { name: "wrong audience", value: token({ aud: "https://other.example/mcp" }), status: 401 },
      { name: "missing scope", value: token({ scope: "profile" }), status: 403 }
    ];
    for (const item of cases) {
      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${item.value}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
      });
      assert.equal(response.status, item.status, item.name);
      assert.equal((await response.text()).includes(item.value), false, `${item.name} token leaked in response`);
    }
  });
});

test("a valid token can carry synthetic evidence through the stateless remote endpoint", async () => {
  await withServer(async (base) => {
    const queryOnly = await fetch(`${base}/mcp?token=${encodeURIComponent(token())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "ping" })
    });
    assert.equal(queryOnly.status, 401, "query-string tokens must never authenticate");

    const accessToken = token();
    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "assess_fitness_state",
          arguments: {
            userId: "synthetic-user",
            date: "2026-07-27",
            evidence: {
              healthMetrics: [{ type: "hrv_ms", value: 44, unit: "ms", recordedAt: "2026-07-27T06:00:00Z", source: "whoop", basis: "device_measured" }],
              workouts: []
            }
          }
        }
      })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const output = JSON.parse(payload.result?.content?.[0]?.text || "{}");
    assert.equal(output.userId, "synthetic-user");
    assert.ok(output.signalCoverage);
    assert.equal(JSON.stringify(payload).includes(accessToken), false, "access token must not be reflected");
  });
});

test("HTTPS construction fails closed without operator-provided TLS material", () => {
  assert.throws(() => createHttpServer({
    oauth: { resource: RESOURCE, authorizationServers: [ISSUER], issuers: [ISSUER] }
  }), /signature verifier/);
  assert.throws(() => createConfiguredServer({ MCP_PUBLIC_URL: "https://remote.example/mcp" }), /MCP_TLS_KEY_PATH/);
  assert.throws(() => createConfiguredServer({ MCP_TLS_KEY_PATH: "/tmp/synthetic-key" }), /MCP_TLS_CERT_PATH/);
});
