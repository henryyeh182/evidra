// Copyright (c) 2026 Henry Yeh. All rights reserved.

import test from "node:test";
import assert from "node:assert/strict";

import { createLocalAuthorizationServer } from "../src/authorizationServer.js";
import { createHttpServer } from "../src/http.js";

const RESOURCE = "http://127.0.0.1:8787/mcp";

function makeAuth(options = {}) {
  let clock = 1_800_000_000;
  const events = [];
  const auth = createLocalAuthorizationServer({
    issuer: "http://127.0.0.1:8788",
    resource: RESOURCE,
    accessTokenTtlSeconds: 60,
    now: () => clock,
    logger: (event) => events.push(event),
    ...options
  });
  return { auth, events, advance: (seconds) => { clock += seconds; } };
}

test("pairing is one-time and issues short-lived audience-bound tokens", async () => {
  const { auth } = makeAuth();
  const pairing = auth.createPairingCode({ userId: "user-1" });
  const paired = auth.pairDevice({ code: pairing.code, deviceName: "phone" });
  const claims = await auth.createVerifier() (paired.tokens.accessToken);

  assert.equal(paired.deviceName, "phone");
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.aud, RESOURCE);
  assert.equal(claims.token_use, "access");
  assert.equal(claims.scope, "fitness.decide");
  assert.equal(claims.exp - claims.iat, 60);
  assert.throws(() => auth.pairDevice({ code: pairing.code }), /invalid, expired, or already used/);
});

test("expired access tokens and wrong issuer, audience, and scope fail closed", async () => {
  const { auth, advance } = makeAuth();
  const paired = auth.pairDevice({ code: auth.createPairingCode({ userId: "user-1" }).code });
  const verifier = auth.createVerifier();
  assert.ok(await verifier(paired.tokens.accessToken));
  advance(61);
  assert.equal(await verifier(paired.tokens.accessToken), null);

  const other = makeAuth({ resource: "http://other.example/mcp" }).auth;
  const otherPaired = other.pairDevice({ code: other.createPairingCode({ userId: "user-1" }).code });
  assert.equal(await verifier(otherPaired.tokens.accessToken), null);
});

test("refresh rotation rejects replay and revokes the token family", async () => {
  const { auth } = makeAuth();
  const paired = auth.pairDevice({ code: auth.createPairingCode({ userId: "user-1" }).code });
  const rotated = auth.refresh({ refreshToken: paired.tokens.refreshToken });
  assert.notEqual(rotated.refreshToken, paired.tokens.refreshToken);
  assert.ok(await auth.createVerifier()(rotated.accessToken));
  assert.throws(() => auth.refresh({ refreshToken: paired.tokens.refreshToken }), /reuse detected/);
  assert.equal(await auth.createVerifier()(rotated.accessToken), null);
});

test("unlinking a device revokes existing access and refresh credentials", async () => {
  const { auth } = makeAuth();
  const paired = auth.pairDevice({ code: auth.createPairingCode({ userId: "user-1" }).code });
  assert.equal(auth.unlinkDevice(paired.deviceId), true);
  assert.equal(await auth.createVerifier()(paired.tokens.accessToken), null);
  assert.throws(() => auth.refresh({ refreshToken: paired.tokens.refreshToken }), /revoked/);
  assert.equal(auth.unlinkDevice(paired.deviceId), false);
});

test("resource server rejects a revoked token and auth logs contain no token, code, or claims", async () => {
  const { auth, events } = makeAuth({ now: () => Math.floor(Date.now() / 1000) });
  const pairing = auth.createPairingCode({ userId: "user-1" });
  const paired = auth.pairDevice({ code: pairing.code });
  const server = createHttpServer({
    endpoint: "/mcp",
    oauth: {
      resource: RESOURCE,
      authorizationServers: [auth.metadata().issuer],
      issuers: [auth.metadata().issuer],
      scopes: ["fitness.decide"],
      requiredScopes: ["fitness.decide"],
      verify: auth.createVerifier()
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const request = () => fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${paired.tokens.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
    });
    assert.equal((await request()).status, 200);
    auth.revokeAccessToken(paired.tokens.accessToken);
    const denied = await request();
    assert.equal(denied.status, 401);
    const logText = JSON.stringify(events);
    assert.equal(logText.includes(pairing.code), false);
    assert.equal(logText.includes(paired.tokens.accessToken), false);
    assert.equal(logText.includes("fitness.decide"), false);
    assert.equal(logText.includes("user-1"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
