// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { constants, createPublicKey, verify as verifySignature } from "node:crypto";

/**
 * OAuth 2.1 Resource Server — our half of the authorization chain.
 *
 * The MCP authorization spec splits the work in two, and only one half is ours:
 *
 *   Authorization Server  issues tokens, talks to the user, runs the consent
 *                         screen. Explicitly "beyond the scope" of the MCP
 *                         spec — it may be a separate entity, and for us it is.
 *   Resource Server       says where its authorization server lives, then
 *                         refuses every request that does not carry a token
 *                         issued *for it*. That is this file.
 *
 * Why that split matters here: Evidra holds no health data, so a token buys
 * access to a decision engine, not to a data store. The thing that must not
 * happen is accepting a token minted for somebody else's service — which is
 * exactly what audience validation prevents, and exactly what a shared secret
 * cannot express.
 *
 * Spec: MCP 2025-06-18 authorization · RFC 9728 (protected resource metadata)
 * · RFC 8707 (resource indicators) · OAuth 2.1 §5.2 (token validation).
 */

/**
 * RFC 9728 Protected Resource Metadata.
 *
 * The client hits a 401, reads `WWW-Authenticate`, fetches this document, and
 * learns which authorization server to go to. Without it a client has nowhere
 * to start, which is why the spec makes it a MUST for the server rather than
 * something a README explains.
 *
 * @param {{ resource: string, authorizationServers: string[], scopes?: string[] }} config
 */
export function protectedResourceMetadata(config) {
  return {
    resource: config.resource,
    authorization_servers: config.authorizationServers,
    bearer_methods_supported: ["header"],
    ...(config.scopes ? { scopes_supported: config.scopes } : {}),
    resource_documentation: config.documentation || undefined
  };
}

/**
 * The canonical resource URI this server answers to.
 *
 * Tokens are bound to this string, so it has to be the same string the client
 * put in its `resource` parameter: lowercase scheme and host, no fragment, and
 * no trailing slash unless the slash means something.
 */
export function canonicalResourceUri(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Resource URI must use http or https: ${value}`);
  }
  if (url.username || url.password || url.search) {
    throw new Error(`Resource URI must not contain credentials or a query: ${value}`);
  }
  if (url.hash) throw new Error(`Resource URI must not contain a fragment: ${value}`);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  let out = url.origin + url.pathname;
  if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
  if (url.pathname === "/") out = url.origin;
  return out;
}

const base64UrlDecode = (segment) =>
  Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const base64UrlBuffer = (segment) =>
  Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function parseJwt(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const claims = JSON.parse(base64UrlDecode(parts[1]));
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return null;
    const signature = base64UrlBuffer(parts[2]);
    // Base64url's final character may contain padding bits. Re-encoding makes
    // those bits canonical, so a token with a changed-but-equivalent suffix
    // cannot pass the signature verifier or confuse audit logs.
    if (signature.toString("base64url") !== parts[2]) return null;
    return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature };
  } catch {
    return null;
  }
}

function ecdsaJoseToDer(signature) {
  if (signature.length % 2 !== 0) return null;
  const width = signature.length / 2;
  const integer = (bytes) => {
    let value = Buffer.from(bytes);
    while (value.length > 1 && value[0] === 0) value = value.subarray(1);
    if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
    return Buffer.concat([Buffer.from([0x02, value.length]), value]);
  };
  const r = integer(signature.subarray(0, width));
  const s = integer(signature.subarray(width));
  const body = Buffer.concat([r, s]);
  if (body.length >= 128) return Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

function keyForHeader(header, config) {
  const keys = config.jwks || config.publicKeys || [];
  const entries = Array.isArray(keys)
    ? keys.map((key) => [key.kid, key])
    : Object.entries(keys);
  const candidates = entries
    .filter(([kid, key]) => (!header.kid || kid === header.kid || key?.kid === header.kid))
    .map(([, key]) => key)
    .filter((key) => key && (!key.alg || key.alg === header.alg) && (!key.use || key.use === "sig"));
  if (candidates.length !== 1) return null;
  try {
    const key = candidates[0];
    return key.kty || key.crv ? createPublicKey({ key, format: "jwk" }) : createPublicKey(key);
  } catch {
    return null;
  }
}

/**
 * Verify a compact JWT using an operator-supplied public JWKS. This function
 * intentionally does not discover keys from an untrusted token or accept
 * `alg: none`; key discovery belongs to the configured authorization-server
 * boundary, and the algorithm allow-list is part of deployment configuration.
 *
 * @returns {object|null} verified claims, or null when the JWS is invalid
 */
export function verifyJwtSignature(token, config = {}) {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  const allowedAlgorithms = config.algorithms || ["RS256", "PS256", "ES256", "EdDSA"];
  if (!allowedAlgorithms.includes(parsed.header.alg) || parsed.header.alg === "none") return null;

  const key = keyForHeader(parsed.header, config);
  if (!key) return null;

  let signature = parsed.signature;
  let algorithm = parsed.header.alg;
  let options;
  if (parsed.header.alg.startsWith("ES")) {
    const expectedBytes = { ES256: 64, ES384: 96, ES512: 132 }[parsed.header.alg];
    if (signature.length !== expectedBytes) return null;
    signature = ecdsaJoseToDer(signature);
    algorithm = { ES256: "sha256", ES384: "sha384", ES512: "sha512" }[parsed.header.alg];
  } else if (parsed.header.alg.startsWith("RS")) {
    algorithm = { RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512" }[parsed.header.alg];
  } else if (parsed.header.alg.startsWith("PS")) {
    algorithm = { PS256: "sha256", PS384: "sha384", PS512: "sha512" }[parsed.header.alg];
    options = {
      key,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: { PS256: 32, PS384: 48, PS512: 64 }[parsed.header.alg]
    };
  } else if (parsed.header.alg === "EdDSA") {
    algorithm = null;
  } else {
    return null;
  }

  try {
    const valid = verifySignature(algorithm, Buffer.from(parsed.signingInput), options || key, signature);
    return valid ? parsed.claims : null;
  } catch {
    return null;
  }
}

/**
 * Build a verifier for a static authorization-server JWKS URL. The URL is
 * configuration, never token input; it must be HTTPS. A short in-memory cache
 * avoids fetching keys for every call without turning this resource server into
 * a token store. Tests can inject fetchImpl and never contact a real provider.
 */
export function createJwksVerifier({ jwksUrl, fetchImpl = globalThis.fetch, cacheTtlSeconds = 300, algorithms } = {}) {
  const url = new URL(jwksUrl);
  if (url.protocol !== "https:") throw new Error("JWKS URL must use HTTPS.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required for JWKS verification.");
  let cached = null;
  let expiresAt = 0;

  return async (token) => {
    const now = Date.now();
    if (!cached || now >= expiresAt) {
      const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`JWKS endpoint returned ${response.status}.`);
      const body = await response.json();
      if (!body || !Array.isArray(body.keys)) throw new Error("JWKS response has no keys array.");
      cached = body.keys;
      expiresAt = now + cacheTtlSeconds * 1000;
    }
    return verifyJwtSignature(token, { jwks: cached, algorithms });
  };
}

/**
 * Read a JWT's claims without verifying it.
 *
 * Separate from verification on purpose: decoding is how we learn which
 * authorization server to ask, verifying is what makes the claims mean
 * anything. Never treat the output of this as trusted.
 */
export function decodeJwtClaims(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return null;
  }
}

/**
 * Is this token meant for us, and is it still alive?
 *
 * Audience is the load-bearing check. A token minted for another service by the
 * same authorization server is a perfectly valid token — accepting it is how an
 * MCP server becomes a confused deputy, and the spec forbids it in as many
 * words.
 *
 * Signature verification is deliberately *not* done here: it depends on the
 * authorization server's keys and belongs to whatever verifier is configured.
 * This function checks the claims a verified token must still satisfy.
 *
 * @param {object} claims
 * @param {{ resource: string, issuers?: string[], now?: number, leewaySeconds?: number }} config
 * @returns {{ ok: true } | { ok: false, status: number, error: string, description: string }}
 */
export function checkTokenClaims(claims, config) {
  const now = config.now ?? Math.floor(Date.now() / 1000);
  const leeway = config.leewaySeconds ?? 30;

  if (!claims || typeof claims !== "object") {
    return { ok: false, status: 401, error: "invalid_token", description: "Token could not be read." };
  }

  if (!Number.isFinite(claims.exp)) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token has no valid expiry." };
  }
  if (claims.exp + leeway < now) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token has expired." };
  }
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token is not valid yet." };
  }

  if (typeof claims.iss !== "string" || claims.iss.length === 0) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token has no valid issuer." };
  }
  if (config.issuers && config.issuers.length > 0 && !config.issuers.includes(claims.iss)) {
    // A token from an issuer we do not know is not ours to interpret, however
    // well-formed it looks.
    return { ok: false, status: 401, error: "invalid_token", description: "Token issuer is not recognised." };
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  const canonical = canonicalResourceUri(config.resource);
  const matches = audience.some((value) => {
    try {
      return canonicalResourceUri(value) === canonical;
    } catch {
      return value === canonical;
    }
  });
  if (!matches) {
    return {
      ok: false,
      status: 401,
      error: "invalid_token",
      description: "Token was not issued for this resource."
    };
  }

  if (config.requiredScopes?.length) {
    const granted = String(claims.scope || "").split(/\s+/).filter(Boolean);
    const missing = config.requiredScopes.filter((scope) => !granted.includes(scope));
    if (missing.length > 0) {
      // 403, not 401: the caller is who they say they are, they just are not
      // allowed to do this. Sending 401 would tell the client to re-authorize,
      // which would not help.
      return {
        ok: false,
        status: 403,
        error: "insufficient_scope",
        description: `Missing scope: ${missing.join(" ")}`
      };
    }
  }

  return { ok: true };
}

/**
 * The `WWW-Authenticate` value a 401 must carry.
 *
 * The `resource_metadata` parameter is the whole point — it is how a client
 * that has never seen this server discovers where to authorize.
 */
export function wwwAuthenticate({ resourceMetadataUrl, error, description }) {
  const quote = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
  const parts = [`Bearer resource_metadata="${quote(resourceMetadataUrl)}"`];
  if (error) parts.push(`error="${quote(error)}"`);
  if (description) parts.push(`error_description="${quote(description)}"`);
  return parts.join(", ");
}

/**
 * Pull the bearer token out of a request.
 *
 * Header only. The spec says access tokens MUST NOT appear in a URI query
 * string, and it is right: query strings end up in proxy logs, browser history
 * and referrer headers. A token that has been logged is a token that has been
 * shared.
 */
export function bearerFromHeaders(headers) {
  const value = headers?.authorization || headers?.Authorization || "";
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}
