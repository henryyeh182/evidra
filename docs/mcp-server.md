# MCP Server

Exposes the Fitness Decision Engine as MCP tools. Dependency-free: a small
JSON-RPC dispatcher with the transport kept separate from the decision logic.

Supported methods: `initialize` · `ping` · `tools/list` · `tools/call`.
Notifications (no `id`) are never answered, per JSON-RPC.

## Transports

| Transport | Entry point | Use for |
|---|---|---|
| **stdio** | `node apps/mcp-server/src/stdio.js` | Claude Desktop, Claude Code — anything on this machine |
| **Streamable HTTP** | `npm run serve:http` | Remote clients: Claude mobile, ChatGPT connectors, agent developers |

Protocol version is negotiated across `2025-06-18`, `2025-03-26`, `2024-11-05`;
an unrecognised request falls back to the newest.

### HTTP options

| Env var | Meaning |
|---|---|
| `PORT` | Listen port (default `8787`) |
| `MCP_TOKEN` | Require `Authorization: Bearer <token>`, or `?token=` for clients with nowhere to set a header |
| `MCP_ALLOWED_ORIGINS` | Comma-separated browser origins. Requests without an `Origin` (native apps, curl) always pass |

Endpoints: `POST /mcp` (JSON-RPC), `GET /mcp` (server stream), `GET /health`.

> Set `MCP_TOKEN` before exposing the server beyond localhost. Origin validation
> is on by default because any web page can POST to localhost, and a server that
> trusts every origin lets a visited site drive the user's tools.

## Tools

Six tools, all of which either return a decision or transform caller-held plan
state. The server does not retain plans or previews. See the [Design
Manifesto](design-manifesto.md) for why the surface is this small.

Two name spaces, deliberately: the names below are the **public** ones — what
`tools/list` advertises and what a client calls. Internally the canonical names
keep the `evidra_` prefix, and the public names route to them through aliases,
so `schemas/tools/evidra_*.json`, `outputSchemas.js`, the eval golden set and
the Decision Harness all still speak the canonical form. A call that arrives
under either name resolves to the same handler.

`evidence` is the required argument on every decision tool except
`decide_exercise_substitution`, which reads no recovery or load signal and
decides from the movement plus the constraints the caller states; `userId` is an
optional label the server echoes back and never computes on. A call that
arrives without evidence gets a tool result carrying `isError` and an
`evidence_required` payload naming what to go and fetch — not a JSON-RPC error,
so the host reads it and acts rather than showing the user a failed tool call.
Evidence that arrives in the wrong shape gets the same treatment as
`invalid_evidence`, carrying the rule that was broken and the shape it should
have had, so the caller can correct its payload in the same turn. The same holds
for everything else a caller can get wrong: a movement the catalog does not
carry (`unknown_exercise`), a plan tool called without the plan the caller holds
(`plan_required`, `plan_state_required`), a change the plan cannot carry
(`plan_change_refused`), and a preview built against an older version
(`commit_refused`).

Every advertised tool declares an `outputSchema` and answers with
`structuredContent` as well as the serialized text block, so a host can read the
result as an object instead of parsing prose. The schemas are the same files in
`schemas/tools/` that the eval runner validates real payloads against; the two
copies are held identical by `eval/test/contract.test.js`. Where a tool could not
run, only the text block is sent — an error payload matches no output schema.

Shared guidance — where evidence comes from, that any single source is enough,
that plans live with the caller, and that a returned decision is not to be
re-derived — is sent once in the `instructions` field of the initialize result
rather than repeated in every tool description.
The local demo seed is reachable only by asking for it outright and is absent
from the public schemas: it is another person's numbers and must never reach a
real caller's answer by way of a silent fallback.

### `assess_fitness_state` — read-only

Recovery, readiness, and fatigue verdicts, plus training load (ATL/CTL/TSB),
personal baselines, and which signals were usable.

```json
{
  "userId": "u1",
  "date": "2026-07-27",
  "evidence": { "healthMetrics": [], "workouts": [], "vendorAssessments": [] }
}
```

### `decide_session` — read-only, the core primitive

Takes today's **scheduled** session and today's evidence, and returns what the
session should become. Without a scheduled session there is nothing to decide,
and it says so rather than degrading into a suggestion.

```json
{
  "userId": "u1",
  "date": "2026-07-27",
  "scheduledSession": {
    "focus": "Tempo Run", "type": "run", "durationMinutes": 45,
    "intensity": "high", "targetMuscleGroups": ["legs"], "exercises": ["Tempo Run"]
  },
  "evidence": { "...": "as above" }
}
```

Returns the five-layer decision:

```json
{
  "evidence": [{ "signal": "readiness", "value": 52 }],
  "state": { "readiness": 52, "acwr": 1.7 },
  "decision": { "type": "adjust", "intent": "reduce_today_intensity" },
  "action": {
    "from": { "focus": "Tempo Run", "intensity": "high" },
    "to":   { "focus": "Moderate run", "intensity": "moderate" },
    "changed": ["focus", "intensity"]
  },
  "reason": [
    "Readiness 52 is below 60, so intensity comes down.",
    "At moderate intensity the session is no longer \"Tempo Run\"; it becomes \"Moderate run\"."
  ],
  "confidence": "medium",
  "signalCoverage": {
    "recovery": { "usable": ["hrv"], "missing": ["sleep"] },
    "training": { "usable": [], "missing": ["trainingLoad"] }
  },
  "limits": [
    "No sleep signal was available, so confidence is lowered.",
    "Some sessions in the last 7 days carry no training load, so muscle fatigue is read from an incomplete week."
  ],
  "decisionBasis": {
    "libraryVersion": "1.4.0",
    "engineVersion": "1.6.0",
    "policies": { "arbitration": "category_then_priority", "combination": "most_restrictive_wins" },
    "governingRule": {
      "ruleId": "EVD-R-006",
      "title": "An acute load spike pulls intensity down one step",
      "basis": "external_metric",
      "evidence": { "studyDesign": "observational", "recommendationStrength": "supports_direction_only" },
      "measured": { "quantity": "acwr", "value": 1.7 },
      "thresholds": [{ "key": "acwrHigh", "operator": ">", "value": 1.4, "unit": "ratio" }],
      "sources": ["… citation, what it supports, what it does not, verificationStatus …"],
      "contested": ["… published objections, each with its own verificationStatus …"],
      "limitations": ["1.4 matches neither published figure. It is our choice, not the literature's."]
    },
    "appliedRules": ["… the rules that also fired, in compact form …"]
  }
}
```

`decisionBasis` is abridged above; the arrays come back populated. It is
required on every `decide_session` result and returned by that tool
alone — the other five tools' numbers are not in the rule library yet, so they
do not carry it. Two rules fire on this evidence, readiness and acute load; the
arbitration policy attributes the decision to the one with the higher priority
inside the same category, and the other travels in `appliedRules`. Attribution
and combination are separate: the governing rule explains the decision, it does
not necessarily set the size of the change.

`libraryVersion` and `engineVersion` move independently, and neither is the
version of the installed extension — the thresholds and their provenance, the
code that applied them, and the packaged release each change for their own
reasons.

`signalCoverage` is split in two because the gaps are different in kind:
`recovery` is about how fresh today's sleep/HRV/resting-HR/stress readings are,
`training` about whether every session in the last 7 days carried a training
load. A session without one is left out of muscle fatigue rather than counted as
zero, and `training.missing` is how the caller learns that happened.

The load is the vendor's own effort figure — Garmin's `activityTrainingLoad`,
Strava's Relative Effort, Apple Health's active energy — and is used as it
stands. RPE is carried as evidence but is not a term in any sum, so a source
that never reports one loses nothing.

`decision.type` is one of `keep` · `adjust` · `substitute` · `defer` ·
`advance`. A `keep` is still a decision and still carries its evidence.

### `decide_exercise_substitution` — read-only

One movement in, its replacement out, with the joint filter applied
server-side.

```json
{ "exerciseId": "exercise_back_squat", "conditions": ["knee_injury"], "avoidContraindications": ["knee"] }
```

### `generate_plan` — read-only

Builds the periodized plan that later decisions act on. Read-only because there
is nothing here for it to write to: the plan is returned and the caller decides
whether to keep it. `commit_adjust_plan` is the one tool that declares itself not
read-only, and not because it stores anything either — it must not be called
without the user having seen and accepted the preview.

### `preview_adjust_plan` / `commit_adjust_plan` — stateless two-phase transform

Both tools receive caller-held state. `preview` returns a deterministic patch
containing the diff, base version, and resulting plan. `commit` receives the
current plan plus that patch, validates the optimistic-concurrency version,
and returns the next plan. The AI host or external storage owns approval,
history, and persistence; this server retains neither plan nor preview.

## Evidence

Decision tools take an `evidence` object rather than reading any store — the AI
layer holds the user's authorization and passes it in, and this server keeps
nothing. Every response carries `provenance` naming whether real evidence or
the local demo seed was used.

Sources are normalized into one vocabulary by
[`packages/evidence/src/schemaRegistry.js`](../packages/evidence/src/schemaRegistry.js).
A missing signal never breaks a decision: weights renormalize over what is
present and confidence follows the evidence.

## Deprecated tools

These still resolve for one release but are hidden from `tools/list`:
`get_semantic_fitness_state` (→ `evidra_assess_fitness_state`), `recommend_workout`,
`get_training_context`, `search_exercises`, `get_exercise`, `search_workouts`,
`get_workout`, `get_user_profile`, `get_training_history`, `get_plan`,
`list_plans`, and the pre-rename plan names.

## Local commands

```bash
npm run demo:mcp                     # drive the tools in-process
node apps/mcp-server/src/stdio.js    # stdio transport
npm run serve:http                   # HTTP transport on :8787
npm test                             # full suite
```

Client config sample: [`mcp-client-config.example.json`](mcp-client-config.example.json)
— replace the path with this repo's absolute location.

## Not yet built

Remote access is one piece of work, not three, and it belongs to Form 2 — the
remote MCP server described in the [plan](fitness-mcp-implementation-plan.md).
End-to-end OAuth, a public HTTPS deployment and an authorization server land
together or not at all, and none of them is near-term. What exists today is
Form 1: stdio, on the user's own machine.

- **End-to-end OAuth.** The resource-server half is written and dormant:
  `oauth.js` serves RFC 9728 protected-resource metadata and checks a token's
  audience, issuer, expiry and scopes, and `createHttpServer` enforces all of it
  when handed an `oauth` option. Nothing hands it one. Signature verification is
  deliberately outside `checkTokenClaims` — it depends on the authorization
  server's keys — and no verifier is configured anywhere, so nothing today
  proves a token was minted rather than typed. The `serve:http` entry point
  never passes `oauth`, so running it gives the shared-token mode described
  above. Do not read the presence of `oauth.js` as OAuth being available.
- **An authorization server.** None exists. The hard requirement on picking one
  is CIMD support, recorded as D-REGISTRATION in the plan.
- **A public HTTPS deployment.** The HTTP transport binds loopback by default
  and has only ever run locally.
- `idempotency-key` on commit, and server-side resolution of relative dates —
  the one item here that is not Form 2 work
