// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import {
  protectedResourceMetadata,
  canonicalResourceUri,
  decodeJwtClaims,
  checkTokenClaims,
  wwwAuthenticate,
  bearerFromHeaders
} from "../src/oauth.js";

const RESOURCE = "https://evidra.example/mcp";
const NOW = 1_800_000_000;

const claims = (overrides = {}) => ({
  iss: "https://auth.example",
  aud: RESOURCE,
  exp: NOW + 600,
  ...overrides
});

test("the metadata document names an authorization server, which is its whole job", () => {
  const doc = protectedResourceMetadata({
    resource: RESOURCE,
    authorizationServers: ["https://auth.example"],
    scopes: ["fitness.decide"]
  });

  assert.equal(doc.resource, RESOURCE);
  assert.deepEqual(doc.authorization_servers, ["https://auth.example"]);
  assert.deepEqual(doc.bearer_methods_supported, ["header"]);
  assert.deepEqual(doc.scopes_supported, ["fitness.decide"]);
});

test("the canonical resource URI is the string tokens get bound to", () => {
  assert.equal(canonicalResourceUri("HTTPS://Evidra.Example/mcp"), "https://evidra.example/mcp");
  assert.equal(canonicalResourceUri("https://evidra.example/"), "https://evidra.example");
  assert.equal(canonicalResourceUri("https://evidra.example/mcp/"), "https://evidra.example/mcp");
  assert.equal(canonicalResourceUri("https://evidra.example:8443/mcp"), "https://evidra.example:8443/mcp");
  // A fragment cannot be part of an identifier the two sides must agree on.
  assert.throws(() => canonicalResourceUri("https://evidra.example/mcp#x"), /fragment/);
});

test("a token issued for someone else is refused, however valid it is", () => {
  const verdict = checkTokenClaims(claims({ aud: "https://other.example/mcp" }), {
    resource: RESOURCE,
    now: NOW
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
  assert.equal(verdict.error, "invalid_token");
  assert.match(verdict.description, /not issued for this resource/);
});

test("audience is matched canonically, so a trailing slash is not a rejection", () => {
  const verdict = checkTokenClaims(claims({ aud: ["https://elsewhere.example", "https://evidra.example/mcp/"] }), {
    resource: RESOURCE,
    now: NOW
  });
  assert.equal(verdict.ok, true);
});

test("expiry and not-before are honoured, with a little clock leeway", () => {
  assert.equal(checkTokenClaims(claims({ exp: NOW - 600 }), { resource: RESOURCE, now: NOW }).ok, false);
  // Inside the leeway window a barely-expired token still passes; clocks drift.
  assert.equal(checkTokenClaims(claims({ exp: NOW - 5 }), { resource: RESOURCE, now: NOW }).ok, true);
  assert.equal(checkTokenClaims(claims({ nbf: NOW + 600 }), { resource: RESOURCE, now: NOW }).ok, false);
});

test("an unknown issuer is not ours to interpret", () => {
  const verdict = checkTokenClaims(claims({ iss: "https://attacker.example" }), {
    resource: RESOURCE,
    issuers: ["https://auth.example"],
    now: NOW
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 401);
});

test("missing scope is 403, not 401 — re-authorizing would not help", () => {
  const verdict = checkTokenClaims(claims({ scope: "profile" }), {
    resource: RESOURCE,
    requiredScopes: ["fitness.decide"],
    now: NOW
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 403);
  assert.equal(verdict.error, "insufficient_scope");
  assert.match(verdict.description, /fitness\.decide/);
});

test("WWW-Authenticate carries the metadata URL a first-time client needs", () => {
  const header = wwwAuthenticate({
    resourceMetadataUrl: "https://evidra.example/.well-known/oauth-protected-resource",
    error: "invalid_token",
    description: "Token has expired."
  });

  assert.match(header, /^Bearer resource_metadata="https:\/\/evidra\.example\/\.well-known\/oauth-protected-resource"/);
  assert.match(header, /error="invalid_token"/);
});

test("tokens are read from the header only — a query string is not a place for a secret", () => {
  assert.equal(bearerFromHeaders({ authorization: "Bearer abc" }), "abc");
  assert.equal(bearerFromHeaders({ authorization: "Basic abc" }), null);
  assert.equal(bearerFromHeaders({ authorization: "Bearer " }), null);
  assert.equal(bearerFromHeaders({}), null);
});

test("claims can be read without being trusted", () => {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const token = `x.${encode({ sub: "user_1", aud: RESOURCE })}.y`;

  assert.equal(decodeJwtClaims(token).sub, "user_1");
  assert.equal(decodeJwtClaims("not-a-jwt"), null);
  assert.equal(decodeJwtClaims("a.b.c"), null);
});

test("a token that cannot be read is refused rather than treated as empty", () => {
  assert.equal(checkTokenClaims(null, { resource: RESOURCE, now: NOW }).ok, false);
  assert.equal(checkTokenClaims("string", { resource: RESOURCE, now: NOW }).ok, false);
});
