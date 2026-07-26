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

Six tools, all of which either return a decision or maintain the plan a
decision acts on. See the [Design Manifesto](design-manifesto.md) for why the
surface is this small.

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
    "to":   { "focus": "Tempo Run", "intensity": "moderate" },
    "changed": ["intensity"]
  },
  "reason": ["Readiness 52 低於 60，需調降強度。"],
  "confidence": "medium",
  "signalCoverage": { "usable": ["hrv"], "missing": ["sleep"] },
  "limits": ["缺少 sleep 訊號，信心下調。"]
}
```

`decision.type` is one of `keep` · `adjust` · `substitute` · `defer` ·
`advance`. A `keep` is still a decision and still carries its evidence.

### `decide_exercise_substitution` — read-only

One movement in, its replacement out, with the joint filter applied
server-side.

```json
{ "exerciseId": "exercise_back_squat", "conditions": ["knee_injury"], "avoidContraindications": ["knee"] }
```

### `generate_plan` — write

Builds the periodized plan that later decisions act on.

### `preview_adjust_plan` / `commit_adjust_plan` — write, two-phase

`preview` returns a diff and a `previewId`; nothing changes until `commit` is
called with it. A commit without a valid preview is refused.

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
`get_semantic_fitness_state` (→ `assess_fitness_state`), `recommend_workout`,
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

- OAuth 2.1 Resource Server with dynamic client registration, required before
  third parties can connect (see D-PROTO in the [plan](fitness-mcp-implementation-plan.md))
- Hosted deployment; the HTTP transport currently runs locally
- `idempotency-key` on commit, and server-side resolution of relative dates
