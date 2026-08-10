// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { checkTokenClaims, verifyJwtSignature } from "./oauth.js";

/**
 * A deliberately small, process-local authorization-server adapter for tests
 * and private development. It is not a hosted account, consent, or billing
 * implementation. The resource server only consumes `createVerifier()` and
 * therefore keeps the AS/RS boundary explicit.
 */
export function createLocalAuthorizationServer({
  issuer = "http://127.0.0.1:8788",
  resource,
  accessTokenTtlSeconds = 300,
  refreshTokenTtlSeconds = 30 * 24 * 60 * 60,
  pairingTtlSeconds = 300,
  defaultScopes = ["fitness.decide"],
  now = () => Math.floor(Date.now() / 1000),
  logger = null
} = {}) {
  if (!resource) throw new Error("A resource URI is required.");
  if (!Number.isInteger(accessTokenTtlSeconds) || accessTokenTtlSeconds < 1 || accessTokenTtlSeconds > 3600) {
    throw new Error("Access-token TTL must be between 1 and 3600 seconds.");
  }
  if (!Number.isInteger(refreshTokenTtlSeconds) || refreshTokenTtlSeconds < 1) {
    throw new Error("Refresh-token TTL must be positive.");
  }
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `local-${randomBytes(8).toString("hex")}`;
  const publicJwk = { ...keyPair.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  const pairings = new Map();
  const devices = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();
  const families = new Map();

  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const id = (prefix) => `${prefix}_${randomBytes(16).toString("hex")}`;
  const emit = (event, fields = {}) => {
    // Never pass secrets, token strings, pairing codes, or claims to a logger.
    if (typeof logger === "function") logger({ event, ...fields });
  };
  const cleanScopes = (scopes) => {
    const values = Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/);
    const unique = [...new Set(values.filter((scope) => defaultScopes.includes(scope)))];
    if (unique.length === 0) throw new Error("No allowed scope was requested.");
    return unique;
  };

  const issueAccessToken = ({ userId, deviceId, familyId, scopes }) => {
    const issuedAt = now();
    const claims = {
      iss: issuer,
      sub: userId,
      aud: resource,
      iat: issuedAt,
      nbf: issuedAt,
      exp: issuedAt + accessTokenTtlSeconds,
      jti: id("at"),
      scope: scopes.join(" "),
      device_id: deviceId,
      token_use: "access",
      family_id: familyId
    };
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const input = `${header}.${payload}`;
    const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), keyPair.privateKey).toString("base64url")}`;
    accessTokens.set(claims.jti, { deviceId, familyId, exp: claims.exp, revokedAt: null });
    return { token, expiresIn: accessTokenTtlSeconds };
  };

  const issueRefreshToken = ({ userId, deviceId, familyId, scopes }) => {
    const token = randomBytes(32).toString("base64url");
    refreshTokens.set(hash(token), {
      userId, deviceId, familyId, scopes, exp: now() + refreshTokenTtlSeconds, usedAt: null
    });
    return token;
  };

  const issueTokenSet = ({ userId, deviceId, familyId, scopes }) => ({
    accessToken: issueAccessToken({ userId, deviceId, familyId, scopes }).token,
    refreshToken: issueRefreshToken({ userId, deviceId, familyId, scopes }),
    tokenType: "Bearer",
    expiresIn: accessTokenTtlSeconds,
    scope: scopes.join(" ")
  });

  return {
    metadata() {
      return { issuer, jwks_uri: `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`, token_endpoint_auth_methods_supported: ["none"] };
    },
    jwks() {
      return { keys: [publicJwk] };
    },
    createPairingCode({ userId, expiresInSeconds = pairingTtlSeconds } = {}) {
      if (!userId) throw new Error("A userId is required to create a pairing code.");
      const code = randomBytes(24).toString("base64url");
      const pairingId = id("pair");
      pairings.set(hash(code), { pairingId, userId, exp: now() + expiresInSeconds, usedAt: null });
      emit("pairing_code_created", { pairingId });
      return { pairingId, code, expiresAt: now() + expiresInSeconds };
    },
    pairDevice({ code, deviceName = "unnamed device", scopes = defaultScopes } = {}) {
      const pairing = pairings.get(hash(String(code || "")));
      if (!pairing || pairing.usedAt || pairing.exp < now()) throw new Error("Pairing code is invalid, expired, or already used.");
      pairing.usedAt = now();
      const deviceId = id("device");
      const familyId = id("family");
      const grantedScopes = cleanScopes(scopes);
      devices.set(deviceId, { deviceId, userId: pairing.userId, deviceName, pairedAt: now(), unlinkedAt: null });
      families.set(familyId, { deviceId, revokedAt: null });
      emit("device_paired", { deviceId, pairingId: pairing.pairingId });
      return { deviceId, deviceName, tokens: issueTokenSet({ userId: pairing.userId, deviceId, familyId, scopes: grantedScopes }) };
    },
    refresh({ refreshToken } = {}) {
      const record = refreshTokens.get(hash(String(refreshToken || "")));
      if (!record || record.exp < now()) throw new Error("Refresh token is invalid or expired.");
      const family = families.get(record.familyId);
      const device = devices.get(record.deviceId);
      if (!family || family.revokedAt || !device || device.unlinkedAt) throw new Error("Refresh token has been revoked.");
      if (record.usedAt) {
        family.revokedAt = now();
        emit("refresh_reuse_detected", { familyId: record.familyId, deviceId: record.deviceId });
        throw new Error("Refresh token reuse detected; token family revoked.");
      }
      record.usedAt = now();
      emit("refresh_rotated", { familyId: record.familyId, deviceId: record.deviceId });
      return issueTokenSet({ userId: record.userId, deviceId: record.deviceId, familyId: record.familyId, scopes: record.scopes });
    },
    revokeAccessToken(token) {
      const claims = verifyJwtSignature(token, { jwks: [publicJwk], algorithms: ["RS256"] });
      if (!claims?.jti) return false;
      const record = accessTokens.get(claims.jti);
      if (!record) return false;
      record.revokedAt = now();
      emit("access_token_revoked", { deviceId: record.deviceId });
      return true;
    },
    unlinkDevice(deviceId) {
      const device = devices.get(deviceId);
      if (!device || device.unlinkedAt) return false;
      device.unlinkedAt = now();
      for (const family of families.values()) if (family.deviceId === deviceId) family.revokedAt = device.unlinkedAt;
      emit("device_unlinked", { deviceId });
      return true;
    },
    listDevices() {
      return [...devices.values()].map(({ deviceId, userId, deviceName, pairedAt, unlinkedAt }) => ({ deviceId, userId, deviceName, pairedAt, unlinkedAt }));
    },
    createVerifier({ requiredScopes = defaultScopes, leewaySeconds = 0 } = {}) {
      return async (token) => {
        const claims = verifyJwtSignature(token, { jwks: [publicJwk], algorithms: ["RS256"] });
        const verdict = checkTokenClaims(claims, { resource, issuers: [issuer], requiredScopes, leewaySeconds, now: now() });
        if (!verdict.ok || claims.token_use !== "access" || typeof claims.jti !== "string") return null;
        const access = accessTokens.get(claims.jti);
        const family = families.get(claims.family_id);
        const device = devices.get(claims.device_id);
        if (!access || access.revokedAt || !family || family.revokedAt || !device || device.unlinkedAt) return null;
        return claims;
      };
    }
  };
}
