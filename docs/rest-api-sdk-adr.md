# ADR: stateless REST API and SDK boundary

Status: proposed contract skeleton; no REST server or public SDK is shipped by
this decision.

Date: 2026-08-10

## Decision

Keep the deterministic engine behind two compatible boundaries:

1. MCP remains the model-facing adapter and keeps the local stdio/MCPB path.
2. A future REST API exposes the same request/response semantics under `/v1`.

The REST service is a stateless decision service. The caller owns raw Evidence,
the current plan, previews, and any Decision/Action/Reason record it wants to
keep. Pacevera may retain bounded operational metadata needed for availability,
rate limiting, or abuse prevention, but not request bodies, Evidence, health
values, provider tokens, JWT claims, or durable decision history in hosted mode.

The machine-readable starting point is
[`schemas/rest/fitness-api.v1.json`](../schemas/rest/fitness-api.v1.json). It is
deliberately a skeleton: endpoint names, shared schemas, error shape, and the
MCP mapping are fixed enough for SDK work; pagination, webhooks, bulk import,
provider OAuth, and a hosted database are not part of this slice.

## Resource and operation contract

| REST operation | MCP tool | State owner | Idempotency |
|---|---|---|---|
| `POST /v1/fitness-state/assess` | `assess_fitness_state` | caller supplies Evidence | Safe to retry; same input is a deterministic computation |
| `POST /v1/session-decisions` | `decide_session` | caller supplies scheduled session and Evidence | Safe to retry; caller may send `Idempotency-Key` for correlation |
| `POST /v1/exercise-substitutions/decide` | `decide_exercise_substitution` | caller supplies movement and constraints | Safe to retry |
| `POST /v1/plans` | `generate_plan` | caller holds returned plan | Safe to retry; returned `planId` is a correlation id, not durable server state |
| `POST /v1/plans/{planId}/previews` | `preview_adjust_plan` | caller holds current plan and preview | Require the caller's current `baseVersion` |
| `POST /v1/plans/{planId}/commits` | `commit_adjust_plan` | caller stores committed plan | Require `Idempotency-Key` and `baseVersion`; reject stale previews with `409` |

`planId`, `decisionId`, `previewId`, and `requestId` are identifiers in the
response contract, not promises that Pacevera can later retrieve a person's
history. A commit response includes the new plan version and carried
`decisionBasis`; it does not cause a server-side write in the hosted boundary.

## Versioning and compatibility

The URL major version (`/v1`) changes only for an incompatible request,
response, or security contract change. Additive response fields are allowed;
clients must ignore unknown fields. The MCP wire protocol version remains a
separate negotiation concern. `server.json` package versions and REST API
versions should be bumped together when the same behavior changes, but a
registry-only metadata update must not be presented as a REST feature.

## Authentication and authorization

REST uses the same OAuth resource-server boundary as remote MCP:

- `Authorization: Bearer <access-token>` only; query-string tokens are rejected.
- HTTPS is mandatory in hosted mode.
- JWT signature is verified against operator-configured JWKS.
- `iss`, canonical `aud`/resource URI, `exp`, `nbf`, and required scope are
  checked before the request body reaches the engine.
- A missing/invalid token is `401` with `WWW-Authenticate`; a valid token
  without the required scope is `403 insufficient_scope`.
- Provider OAuth refresh tokens are never accepted by this service. A future
  user-controlled connector may own provider authorization separately.

## Error model

Every non-2xx REST response uses the shared `application/problem+json` shape:
`type`, `title`, `status`, `code`, `detail`, and `requestId`. Validation errors
may add `fieldErrors`; they must not echo Evidence, bearer tokens, JWT claims,
or raw request bodies. `409` covers stale `baseVersion` and idempotency-key
conflicts; `422` covers a valid request that cannot produce the requested
decision; `429` is for operational rate limiting.

## Idempotency and retries

Deterministic read/compute operations are naturally retryable. The commit
operation additionally requires `Idempotency-Key` so a caller can correlate a
retry without sending the plan twice. The key is scoped to the authenticated
subject, route, and request digest; any future metadata store must keep only
that digest/status tuple, with a bounded TTL, and must never persist the
Evidence or a health-bearing response body. `If-Match: "plan-version"` (or the
equivalent `baseVersion`) prevents a preview from overwriting a newer caller-
held plan.

## Evidence privacy

Evidence is request input, not a REST resource. It is normalized at the
boundary, used for one computation, and released after the response. Logs,
traces, error telemetry, caches, queues, and retries must exclude bodies,
tool arguments, health values, stable user ids, provider tokens, and JWT
claims. `userId` remains an optional caller label for response correlation; it
is not an authentication identity and must not be used as one.

## SDK direction

Start with thin, generated-schema clients rather than provider SDKs:

- TypeScript/JavaScript: `@pacevera/sdk` with discriminated result types and
  `AbortSignal` support.
- Python: `pacevera` with typed dataclasses/Pydantic-compatible models.
- Swift and Kotlin: generate models and an async HTTP transport after the REST
  contract is stable enough for mobile use.

All bindings should expose the same `FitnessEvidence`, `DecisionBasis`,
`SignalCoverage`, `Plan`, `PlanPreview`, `ProblemDetails`, and OAuth bearer
configuration. None should offer a method that uploads a provider refresh
token or silently persists Evidence.

## Non-goals and blockers

This ADR does not select an authorization server, cloud, domain, certificate
authority, billing store, provider integration, or data-retention vendor. Those
choices are production blockers for remote REST just as they are for remote
MCP. Until they are decided and reviewed against the privacy contract, the
contract remains local/testable architecture, not a production endpoint.
