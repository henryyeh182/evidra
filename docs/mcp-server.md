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
| `MCP_TOKEN` | Local-development-only shared bearer token; accepted from the `Authorization` header |
| `EVIDRA_STATE_DIR` | Durable athlete records directory (default `data/private/athletes`) |
| `MCP_ALLOWED_ORIGINS` | Comma-separated browser origins. Requests without an `Origin` (native apps, curl) always pass |
| `MCP_PUBLIC_URL` | Hosted resource URI, including `/mcp`; enables HTTPS/OAuth configuration |
| `MCP_TLS_KEY_PATH` / `MCP_TLS_CERT_PATH` | Hosted HTTPS key and certificate paths |
| `MCP_OAUTH_AUTHORIZATION_SERVER` | External authorization-server metadata/issuer base URL |
| `MCP_OAUTH_ISSUER` | Trusted JWT issuer, exact match |
| `MCP_OAUTH_JWKS_URL` | HTTPS JWKS endpoint for signature verification |
| `MCP_OAUTH_SCOPES` / `MCP_OAUTH_REQUIRED_SCOPES` | Space-of-use and required OAuth scopes, comma-separated |

Endpoints: `POST /mcp` (JSON-RPC), `GET /mcp` (server stream), `GET /health`.

> `MCP_TOKEN` is only a local-development fallback. Hosted mode requires HTTPS
> and the OAuth/JWKS variables above; it rejects startup when those are incomplete.
> Origin validation is on because any web page can POST to localhost, and a server
> that trusts every origin lets a visited site drive the user's tools.

## Tools

The ten public tools remain model-agnostic. In local/private mode, when a
request has an authenticated identity or explicit `userId`, new evidence is
merged into that athlete's durable record. Later calls can omit `evidence` and
the server loads the same record. Anonymous calls remain stateless. Hosted
OAuth mode is no-go and forcibly disables this continuity path: it computes
from the current request only. Plans and previews are still caller-owned. See the [Design
Manifesto](design-manifesto.md) for why the surface is this small.

Two name spaces, deliberately: the names below are the **public** ones — what
`tools/list` advertises and what a client calls. Internally the canonical names
keep the `evidra_` prefix, and the public names route to them through aliases,
so `schemas/tools/evidra_*.json`, `outputSchemas.js`, the eval golden set and
the Decision Harness all still speak the canonical form. A call that arrives
under either name resolves to the same handler.

`evidence` is accepted on every decision tool and is optional when a durable
athlete record is available. It remains required in practice for a first call
without an identity. The exception is
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

### Supporting public tools

| Tool | Contract |
|---|---|
| `get_evidence_coverage` | Reports available, missing, and quality-bounded evidence signals. |
| `explain_decision` | Reads the bounded process-local trace for a returned `decisionId`. |
| `submit_outcome` | Normalizes an outcome event; durable outcome storage remains caller-controlled. |
| `generate_workout` | Builds one picker-sized session and runs it through the decision path. |

### `evidra_local_decide_today` — local-only

### `evidra_preview_today` — local-only

Previews the available local health-export sources and signal counts. The desktop
host must show this preview before asking for confirmation and making a daily
session decision.

Only advertised by the packaged `.mcpb` (`apps/local-engine`), never by the
hosted server. Reads an existing plan and today's evidence from this
machine's local SQLite store — set with `PACEVERA_DB_PATH`, populated by
`scripts/import-local-evidence.js` or the per-source `import:*` scripts — and
decides what the already-scheduled session should become. No hosted MCP or
provider token is involved.

## Evidence

Decision tools take an `evidence` object for new activity and read the durable
athlete record only for the authenticated identity making the request. The AI
layer still holds vendor authorization and passes normalized evidence in; this
server does not fetch Apple Health, Garmin, Strava, Oura or Whoop. Every
response carries `provenance` naming whether provided evidence or the shared
record was used.

**Packaged `.mcpb` only**: `assess_fitness_state`, `decide_session`,
`generate_plan` and `generate_workout` also read a local export folder when
the caller supplies no `evidence` (or an empty one) — the folder the user
picked during install (`manifest.json`'s `private_data_dir`, default
`${HOME}/Pacevera`), read by `packages/connectors/src/local/` and
`apps/local-engine/src/localEvidence.js`. Expected subfolders:
`export_apple_health`, `export_garmin/DI_CONNECT`, `export_strava`,
`export_google_health/raw`. A caller that does supply `evidence` — even a
single data point — is never overridden. The hosted server never reads local
files; this is exclusively the local `.mcpb` process reading disk on the same
machine it runs on.

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

## Readiness boundary

Remote access is one piece of work, not three, and it belongs to Form 2 — the
remote MCP server described in the [plan](fitness-mcp-implementation-plan.md).
The repository now contains the resource-server, JWT/JWKS and HTTPS readiness
scaffold, but no real authorization server or public deployment. Local stdio and
the MCPB bundle remain Form 1 and are unchanged.

- **End-to-end OAuth.** The resource-server half is implemented, including
  RFC 9728 metadata, JWT signature verification against configured JWKS, issuer,
  audience, expiry, not-before and scope checks. The entrypoint can build this
  mode from explicit HTTPS environment configuration, but no real authorization
  server is selected or configured. Do not read the scaffold as a production
  OAuth integration.
- **An authorization server.** None exists. The hard requirement on picking one
  is CIMD support, recorded as D-REGISTRATION in the plan.
- **A public HTTPS deployment.** The transport can load operator-supplied TLS
  material and refuses incomplete hosted configuration, but it has no public
  hostname, certificate, cloud account or deployment credentials.
- `idempotency-key` on commit, and server-side resolution of relative dates —
  the one item here that is not Form 2 work
