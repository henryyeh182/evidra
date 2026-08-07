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
import { describePolicies, getRuleLibrary } from "../../../packages/rules/src/index.js";

/**
 * The policy prose the host is told, taken from the library rather than retyped.
 *
 * It used to be a second copy written out in the template below, and the copies
 * drifted exactly as you would expect: the library's own note claimed every
 * rule was in the recovery category long after a training_goal rule was added.
 * Interpolating means the sentence a host reads cannot disagree with the file
 * the engine reads.
 *
 * The category order is derived for the same reason — it is `categories` sorted
 * by rank, and writing it out by hand is one more place for the priority matrix
 * to be described wrongly.
 */
const POLICIES = describePolicies();
const CATEGORY_ORDER = [...getRuleLibrary().categories]
  .sort((a, b) => a.rank - b.rank)
  .map((category) => category.id.replace(/_/g, " "))
  .join(", ");

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
 */
const INSTRUCTIONS = `Evidra computes training decisions from evidence you supply. You gather the evidence; Evidra does the longitudinal arithmetic, applies the injury and load rules, and hands back a decision that explains itself.

Gathering evidence: before calling a decision tool, collect the user's recent health evidence from whichever health source this user actually has — Apple Health, Google Health, Garmin, Strava, Oura, Whoop or any other; the shape is the same and no one source is expected — or, just as validly, from the user themselves: "ran 45 minutes yesterday, slept about seven hours" is evidence, and asking two or three plain questions is the normal way to start when no connector is attached. Pass what you gathered as \`evidence\`. Any single source decides something: training load alone, recovery signals alone, or what the athlete can tell you. More sources raise confidence.

A signal nobody supplied comes back in \`signalCoverage\` and confidence drops to match. That is the design working: the decision still stands, it stands on less, and the caller can see exactly how much. So send what exists and let coverage carry the rest — a filled-in default would make the confidence figure untrue, and a session that arrived without a load figure is an unknown quantity rather than an easy one.

Plans live with you, not here. This server stores no plan, no preview, and no history: pass the plan you hold into the tools that take one, and persist what they return.

The intensity, duration and movements a decision returns are the decision, not a suggestion to refine. Injury contraindications and load limits are applied here; do not re-derive them or reason past the result. What to say to the user is yours; what today's session becomes is not.

Where the thresholds come from. Every threshold the session decision applies lives in a versioned rule library. \`evidra_decide_session\` returns \`decisionBasis\`: the rule the decision is attributed to, the reading that triggered it, and that rule's provenance. The other tools do not return it yet — their numbers are not in the library, so do not tell the user a substitution or a generated plan carries the same rule-level sourcing.

Two policies govern \`decisionBasis\` and are named by id on it. Arbitration (\`${POLICIES.arbitration.id}\`) — ${POLICIES.arbitration.description} Categories rank ${CATEGORY_ORDER}. Combination (\`${POLICIES.combination.id}\`) — ${POLICIES.combination.description} The reason they do not sum: two readings of the same tired athlete are one fact observed twice, not two reasons to stop.

Be accurate about what a rule rests on. \`basis: external_metric\` means the quantity is defined outside Evidra and \`sources\` cite work on it; where that work is disputed, \`contested\` names the objections, and both should be reported together if the user asks. \`basis: internal_composite\` means the threshold cuts a score Evidra computes from weights it chose — no study has used that score, so no citation is possible and \`sources\` is empty by design. Most rules are internal_composite. If the user asks what a decision is based on, say which of the two it is. Do not call an internal threshold evidence-based, and do not read an empty source list as missing information.`;

// Newest first: index 0 is what we offer when the client asks for something
// we do not recognise.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

export async function handleJsonRpcMessage(rawMessage) {
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
        tools: listedToolDefinitions()
      });
    }

    if (method === "tools/call") {
      const toolName = resolveToolName(params.name);
      const tool = getToolDefinition(toolName);
      const handler = toolHandlers[toolName];

      if (!tool || !handler) {
        return jsonRpcError(id, -32602, `Unknown tool: ${params.name}`);
      }

      const result = await handler(params.arguments || {});

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
