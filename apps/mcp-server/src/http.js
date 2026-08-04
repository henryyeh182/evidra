// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Streamable HTTP transport.
 *
 * stdio only reaches a client running on this machine, so a phone can never use
 * it. Remote clients — the Claude mobile app, ChatGPT connectors, any agent
 * developer's service — need HTTP, which makes this the transport the business
 * model actually depends on.
 *
 * Implements the single-endpoint Streamable HTTP form: POST carries a JSON-RPC
 * message and gets a JSON reply, notifications get 202 with no body, and GET is
 * available for a server-initiated stream. Dependency-free, on node:http.
 */
import { createServer } from "node:http";

import { handleJsonRpcMessage } from "./server.js";
import {
  protectedResourceMetadata,
  canonicalResourceUri,
  checkTokenClaims,
  wwwAuthenticate,
  bearerFromHeaders
} from "./oauth.js";

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * DNS-rebinding protection. A page on any origin can POST to localhost, so a
 * local server that trusts every Origin lets a visited website drive the user's
 * MCP tools. Requests with no Origin (curl, native apps, server-to-server) are
 * fine; browser-issued ones must be on the allow list.
 */
function originAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

export function createHttpServer(options = {}) {
  const endpoint = options.endpoint || "/mcp";
  const allowedOrigins = options.allowedOrigins || [];
  const requireToken = options.token || null;

  /**
   * OAuth 2.1 resource-server configuration. Present means every request needs
   * a token issued for this resource; absent falls back to the shared secret,
   * which is a local-development affordance and says so.
   */
  const oauth = options.oauth
    ? {
        resource: canonicalResourceUri(options.oauth.resource),
        authorizationServers: options.oauth.authorizationServers || [],
        scopes: options.oauth.scopes,
        requiredScopes: options.oauth.requiredScopes,
        issuers: options.oauth.issuers,
        // Signature checking belongs to whoever knows the authorization
        // server's keys. Without a verifier this server refuses tokens rather
        // than trusting unsigned claims — an unverified JWT is a string an
        // attacker can write.
        verify: options.oauth.verify || null
      }
    : null;

  if (oauth && oauth.authorizationServers.length === 0) {
    throw new Error("OAuth requires at least one authorization server; a client has nowhere to go without it.");
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    const cors = {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      // `mcp-session-id` stays in allow-headers because a client may still send
      // one and there is no reason to reject the request over it. Nothing exposes
      // it back: this server issues none.
      "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization"
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // Liveness probe, handy when running behind a tunnel.
    if (url.pathname === "/health") {
      sendJson(res, 200, { status: "ok", server: "fitness-mcp", endpoint }, cors);
      return;
    }

    // RFC 9728. Unauthenticated by design: this is the document a client reads
    // *before* it has any token, so demanding one would deadlock discovery.
    if (url.pathname === RESOURCE_METADATA_PATH) {
      if (!oauth) {
        sendJson(res, 404, { error: "This server is not configured as an OAuth resource server." }, cors);
        return;
      }
      sendJson(res, 200, protectedResourceMetadata(oauth), cors);
      return;
    }

    if (url.pathname !== endpoint) {
      sendJson(res, 404, { error: `Not found. MCP endpoint is ${endpoint}` }, cors);
      return;
    }

    if (!originAllowed(req.headers.origin, allowedOrigins)) {
      sendJson(res, 403, { error: "Origin not allowed" }, cors);
      return;
    }

    if (oauth) {
      const metadataUrl = new URL(RESOURCE_METADATA_PATH, oauth.resource).href;
      const deny = (status, error, description) => {
        sendJson(res, status, { error, error_description: description }, {
          ...cors,
          "www-authenticate": wwwAuthenticate({ resourceMetadataUrl: metadataUrl, error, description })
        });
      };

      const token = bearerFromHeaders(req.headers);
      if (!token) {
        // No token is not an error to explain away — it is the start of the
        // flow. The header tells the client where to go next.
        deny(401, "invalid_request", "Authorization header with a Bearer token is required.");
        return;
      }

      let claims;
      try {
        claims = oauth.verify ? await oauth.verify(token) : null;
      } catch {
        claims = null;
      }
      if (!claims) {
        deny(401, "invalid_token", "Token signature could not be verified.");
        return;
      }

      const verdict = checkTokenClaims(claims, oauth);
      if (!verdict.ok) {
        deny(verdict.status, verdict.error, verdict.description);
        return;
      }
    } else if (requireToken) {
      // Local-development fallback: a shared secret, header only. It cannot
      // express an audience, so it is not OAuth and must not be mistaken for
      // it — but it still beats leaving a tunnelled server open.
      if (bearerFromHeaders(req.headers) !== requireToken) {
        sendJson(res, 401, { error: "Unauthorized" }, cors);
        return;
      }
    }

    /**
     * Sessions: there are none, and the server no longer pretends otherwise.
     *
     * It used to mint an `mcp-session-id` at initialize and hand it back, then
     * never check it — a request carrying an invented id was answered exactly
     * like a real one. Issuing an identifier that is not verified only tells
     * clients a guarantee exists. Nothing here needs one: every call carries its
     * own evidence and plan, so any request stands alone. DELETE is still
     * answered so a client that ends its session gets a clean close.
     */
    if (req.method === "DELETE") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // Server-initiated stream. Nothing is pushed yet, but the endpoint must
    // exist and stay open or clients treat the connection as broken.
    if (req.method === "GET") {
      res.writeHead(200, {
        ...cors,
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive"
      });
      res.write(": connected\n\n");
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => clearInterval(keepAlive));
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" }, cors);
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (error) {
      sendJson(res, 413, { error: error.message }, cors);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" }
      }, cors);
      return;
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    const responses = [];

    for (const message of messages) {
      const response = await handleJsonRpcMessage(JSON.stringify(message));
      // Notifications resolve to null and must not produce a frame.
      if (response !== null) responses.push(response);
    }

    const headers = { ...cors };

    if (responses.length === 0) {
      // Every message was a notification: acknowledge without a body.
      res.writeHead(202, headers);
      res.end();
      return;
    }

    sendJson(res, 200, Array.isArray(parsed) ? responses : responses[0], headers);
  });

  return server;
}

// Run directly: node apps/mcp-server/src/http.js
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const port = Number(process.env.PORT || 8787);
  /**
   * Loopback by default, because the default has no authentication.
   *
   * `listen(port)` alone binds every interface: on any shared network the whole
   * tool surface answered unauthenticated requests from other machines, while
   * this same block printed "local only". Exposing it is now something a person
   * types, and the token is named in the same breath.
   */
  const host = process.env.MCP_HOST || "127.0.0.1";
  const token = process.env.MCP_TOKEN || null;
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || "").split(",").filter(Boolean);

  createHttpServer({ token, allowedOrigins }).listen(port, host, () => {
    console.log(`fitness-mcp listening on http://${host}:${port}/mcp`);
    console.log(token ? "auth: bearer token required" : "auth: none");
    console.log(
      host === "127.0.0.1" || host === "localhost"
        ? `bound to ${host}: this machine only. MCP_HOST=0.0.0.0 exposes it — set MCP_TOKEN first.`
        : `bound to ${host}: reachable from other machines${token ? "." : " WITH NO AUTHENTICATION."}`
    );
  });
}
