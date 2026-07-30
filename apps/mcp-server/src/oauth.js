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

  if (typeof claims.exp === "number" && claims.exp + leeway < now) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token has expired." };
  }
  if (typeof claims.nbf === "number" && claims.nbf - leeway > now) {
    return { ok: false, status: 401, error: "invalid_token", description: "Token is not valid yet." };
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
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
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
