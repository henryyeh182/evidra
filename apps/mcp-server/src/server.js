// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rootDir } from "./rootDir.js";
import {
  getToolDefinition,
  listedToolDefinitions,
  outputSchemaFor,
  resolveToolName
} from "./toolDefinitions.js";
import { parseJsonRpcMessage, jsonRpcError, jsonRpcResult } from "./jsonRpc.js";
import { toolHandlers } from "./toolHandlers.js";
import { describePolicies } from "../../../packages/rules/src/index.js";

/**
 * The policy prose the host is told, taken from the library rather than retyped.
 *
 * It used to be a second copy written out in the template below, and the copies
 * drifted exactly as you would expect: the library's own note claimed every
 * rule was in the recovery category long after a training_goal rule was added.
 * Interpolating means the sentence a host reads cannot disagree with the file
 * the engine reads.
 *
 * The derived category order that used to live here went with the sentence that
 * used it, when the instructions were cut to fit the client's 2KB truncation.
 */
const POLICIES = describePolicies();

/**
 * The version a client is told has to be the version that shipped.
 *
 * Written out here as a literal it drifted: clients were told 0.1.0 while the
 * package, the manifest and the released bundle were all 0.1.1, and nothing
 * compared them. Read from the package manifest instead, which cannot drift
 * from itself. No new dependency on the bundle's contents either — package.json
 * has to travel inside it regardless, because `type: module` is what lets these
 * imports resolve at all.
 */
const { version: SERVER_VERSION } = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8")
);

/**
 * What a host needs to know before it picks any tool, said once.
 *
 * Three tool descriptions carried their own copy of where evidence comes from,
 * which made the listing longer for every conversation and gave the same rule
 * three places to drift. The protocol has a field for exactly this.
 *
 * Ordered by what is most costly to get wrong, and kept under 2048 bytes.
 *
 * Claude Code truncates server instructions at 2KB, and this text had reached
 * 3539 — so the last 1491 bytes had never reached a model at all. What sat in
 * those bytes was the whole of the provenance guidance: which tools carry
 * `decisionBasis`, the two policies, and the instruction not to describe an
 * internal threshold as evidence-based. The single most important paragraph
 * here was the one being silently dropped.
 *
 * Ordering alone would only have moved the loss somewhere else, so the text was
 * also cut to fit. Every instruction survives; the prose around them does not.
 * Two things were dropped rather than compressed: the category rank order, and
 * the reason intensity reductions do not sum. Both are mechanism the host
 * reports rather than applies.
 *
 * server.test.js fails the suite if this grows back, which is the part that
 * stops it happening again — nothing caught it the first time. Headroom is thin
 * and about a third of the text is interpolated from the rule library, so a
 * policy description edited there can break the limit from outside this file.
 */
const INSTRUCTIONS = `Evidra turns this user's training evidence into a decision about today's session: keep, ease, substitute, or defer it. Call it when the user asks what to train, whether today's session still fits, or what to do instead of a movement they cannot do — "my knee hurts, what instead of squats" is a call, not a question to answer yourself.

Returned intensity, duration and movements are the decision. Contraindications and load limits are applied here; do not re-derive or override them.

Evidence: use whichever source this user has — Apple Health, Garmin, Strava, Oura, Whoop, any other — or the user's own words; two or three plain questions are a normal start. Pass it as \`evidence\`. Any single source decides something. A signal nobody supplied shows in \`signalCoverage\` and lowers confidence: send what exists, not a default, which makes it untrue.

\`decisionBasis\` travels on every decision. Empty \`appliedRules\` means no rule applied, not that nothing was checked; a rule's \`limitations\` say what it does not do. Two policies, by id: arbitration (\`${POLICIES.arbitration.id}\`) — ${POLICIES.arbitration.description} Combination (\`${POLICIES.combination.id}\`) — ${POLICIES.combination.description}

\`basis: internal_composite\` (most rules) — the threshold cuts a score Evidra computes from weights it chose; no study used that score, so empty \`sources\` is by design, not missing information, and it is not evidence-based. \`basis: external_metric\` — defined outside Evidra; \`sources\` cite work on it, \`contested\` names published objections; report both.

Continuity: OAuth \`sub\` or \`userId\` merges evidence into a durable athlete record; later calls may omit \`evidence\`. Anonymous calls are stateless.`;

// Newest first: index 0 is what we offer when the client asks for something
// we do not recognise.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export async function handleJsonRpcMessage(rawMessage, requestContext = {}) {
  const parsed = parseJsonRpcMessage(rawMessage);
  if (!parsed.ok) {
    return parsed.error;
  }

  const { id, method, params = {} } = parsed.message;

  // A JSON-RPC notification carries no id and must not be answered. Every real
  // MCP client sends `notifications/initialized` right after the handshake, so
  // replying here breaks the very first exchange of a session.
  const isNotification = id === undefined || id === null;
  if (isNotification) {
    return null;
  }

  try {
    if (method === "initialize") {
      // Echo the client's protocol version when we support it, so a newer
      // client is not silently downgraded; otherwise offer our latest.
      const requested = params.protocolVersion;
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return jsonRpcResult(id, {
        protocolVersion: negotiated,
        serverInfo: {
          // `name` is the identifier clients key their config on and cannot
          // change without breaking them; `title` is what a person reads.
          //
          // "Evidra" alone is not unique in the MCP registry: io.github.vitas/
          // evidra is a DevOps flight recorder, published five months earlier
          // and titled the same. Namespaces keep the identifiers distinct, but
          // the title is the only part a person sees in a directory listing, so
          // it is the part that has to say which one this is.
          name: "fitness-mcp",
          title: "Evidra Fitness",
          version: SERVER_VERSION
        },
        capabilities: {
          tools: {}
        },
        instructions: INSTRUCTIONS
      });
    }

    // Keepalive: the spec defines ping as an empty-result round trip.
    if (method === "ping") {
      return jsonRpcResult(id, {});
    }

    if (method === "tools/list") {
      return jsonRpcResult(id, {
        tools: listedToolDefinitions(SERVER_VERSION)
      });
    }

    if (method === "tools/call") {
      const toolName = resolveToolName(params.name);
      const tool = getToolDefinition(toolName);
      const handler = toolHandlers[toolName];

      if (!tool || !handler) {
        return jsonRpcError(id, -32602, `Unknown tool: ${params.name}`);
      }

      const argumentsWithIdentity = { ...(params.arguments || {}) };
      if (requestContext.identity && !argumentsWithIdentity.__mcpIdentity) {
        Object.defineProperty(argumentsWithIdentity, "__mcpIdentity", {
          value: requestContext.identity,
          enumerable: false
        });
      }
      const result = await handler(argumentsWithIdentity);

      // The deprecated tools declare no output schema, so they send no structured
      // result: it would be an object outside any contract, and the payload would
      // travel twice to say so.
      if (result.structuredContent && !outputSchemaFor(toolName)) {
        const { structuredContent, ...textOnly } = result;
        return jsonRpcResult(id, textOnly);
      }

      return jsonRpcResult(id, result);
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return jsonRpcError(id, -32000, error.message);
  }
}
