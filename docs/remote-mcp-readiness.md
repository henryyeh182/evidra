# Remote MCP readiness record

Status: security and contract skeleton only. This is not a production deployment.

The canonical three-mode privacy contract is [`privacy-deployment-contract.md`](privacy-deployment-contract.md).
This file records remote readiness only; it must not be read as a hosted privacy
policy or as evidence that `hosted-remote` is production-ready.

## Evidence contract audit

| Source | Evidence used in this repository | Shape status | Remaining gap |
|---|---|---|---|
| Strava API | Synthetic API-shaped activity plus the checked-in sample activity fixture | Parser and canonical workout mapping are covered; this source carries session effort, not recovery physiology | No live API response was collected in this work; OAuth provider behavior and field availability remain outside the local contract |
| Garmin export | Checked-in de-identified export fixture | Export shape, sentinels, units, timestamps and source labels are covered | Garmin cloud API response shape is not the same thing as this export and was not added |
| Oura API v2 | Synthetic response envelope matching the official OpenAPI field names and endpoint split | `sleep`, `daily_sleep`, `daily_readiness`, `daily_activity`, and `workout` boundaries are covered | No real response was collected; nullable/omitted combinations beyond the fixture need provider-side samples |
| WHOOP API v2 | Synthetic response envelope matching the official OpenAPI field names and score gates | `score_state`, sleep-stage summation, recovery, cycles and workouts are covered | No real response was collected; hardware-gated and calibration combinations need provider-side samples |

The fixtures contain no personal health data. The tests assert canonical names, units,
timestamps, source labels, missingness, vendor provenance, and that numeric
`confidence` is not silently inserted into an evidence metric. Decision confidence
and `signalCoverage` remain output of the decision engine, not a vendor field to copy.

## Remote security boundary

Implemented locally:

- RFC 9728 protected-resource metadata and `WWW-Authenticate` discovery.
- Canonical HTTPS resource URI binding, including audience matching.
- JWT signature verification against operator-configured JWKS with an explicit asymmetric algorithm allow-list; unsigned or forged tokens fail closed.
- issuer, audience, expiry, not-before and scope checks; missing scope is `403 insufficient_scope`.
- bearer tokens are accepted from the `Authorization` header only; query-string tokens are rejected.
- HTTPS construction and environment validation require TLS files, public HTTPS resource URI, authorization-server URL, issuer and HTTPS JWKS URL.
- hosted mode does not receive provider OAuth refresh tokens and does not persist raw evidence; the HTTP handler is request/response only. When a logger is injected, it receives only route/method/status/duration/size metadata.

Not implemented here:

- authorization-server registration, login, consent, token issuance, client metadata, key rotation operations or billing;
- a public hostname, certificate, cloud account, deployment credentials or real authorization-server integration;
- production privacy-policy changes for hosted identifiers and retention because the hosted commercial/authorization design is not finalized; see the canonical contract for the no-go boundary.

The authorization server is an explicit external boundary. No provider or cloud service
has been selected or purchased in this change. Local stdio/MCPB remains unchanged.

## Deployment decision record

Use a standards-compatible authorization server that supports MCP client registration
requirements (including CIMD when the target host requires it), publishes a JWKS, and
can issue audience-bound access tokens. Select the provider only after comparing
registration support, data residency/DPA, key rotation, availability, and per-MAU
cost. Until that decision and credentials exist, the HTTPS entrypoint is a local
readiness scaffold, not a production claim.
