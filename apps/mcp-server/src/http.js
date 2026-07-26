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
import { randomUUID } from "node:crypto";

import { handleJsonRpcMessage } from "./server.js";

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
  const sessions = new Set();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    const cors = {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
      "access-control-expose-headers": "mcp-session-id"
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

    if (url.pathname !== endpoint) {
      sendJson(res, 404, { error: `Not found. MCP endpoint is ${endpoint}` }, cors);
      return;
    }

    if (!originAllowed(req.headers.origin, allowedOrigins)) {
      sendJson(res, 403, { error: "Origin not allowed" }, cors);
      return;
    }

    // Optional shared secret. A tunnel makes this server world-reachable, so a
    // token is the difference between "my data" and "anyone's".
    if (requireToken) {
      const auth = req.headers.authorization || "";
      const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token");
      if (bearer !== requireToken) {
        sendJson(res, 401, { error: "Unauthorized" }, cors);
        return;
      }
    }

    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"];
      sessions.delete(sessionId);
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
    let newSessionId = null;

    for (const message of messages) {
      if (message?.method === "initialize") {
        newSessionId = randomUUID();
        sessions.add(newSessionId);
      }
      const response = await handleJsonRpcMessage(JSON.stringify(message));
      // Notifications resolve to null and must not produce a frame.
      if (response !== null) responses.push(response);
    }

    const headers = { ...cors };
    if (newSessionId) headers["mcp-session-id"] = newSessionId;

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
  const token = process.env.MCP_TOKEN || null;
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || "").split(",").filter(Boolean);

  createHttpServer({ token, allowedOrigins }).listen(port, () => {
    console.log(`fitness-mcp listening on http://localhost:${port}/mcp`);
    console.log(token ? "auth: bearer token required" : "auth: none (local only — add MCP_TOKEN before exposing)");
  });
}
