# Remote MCP readiness record

Status: local security/integration readiness only. This is not a production deployment.

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

### P3 local authorization-server slice

`apps/mcp-server/src/authorizationServer.js` now provides a process-local,
test/private-development authorization-server adapter. It is deliberately not
an account system or hosted deployment. Its boundary is:

- pairing codes are random, short-lived, hashed at rest, and single-use;
- pairing creates a device and token family, with `sub`, `device_id`, `aud`,
  `iss`, `scope`, `iat`/`nbf`, short `exp`, `jti`, and an explicit `token_use`;
- refresh tokens are opaque, hashed, short-lived relative to a credential
  store, and rotated on every use; replay revokes the whole family;
- device unlink and explicit access-token revocation invalidate existing access
  tokens through the verifier as well as refresh credentials;
- the verifier checks signature, issuer, audience, expiry, scope, token type,
  device state, token state, and family state before the resource server runs;
- authorization events contain only bounded identifiers and event names; no
  pairing code, token, JWT claims, Evidence, or stable user identifier is sent
  to the logger.

Threat-model decisions: audience binding prevents a valid token for another
resource from becoming a confused-deputy credential; asymmetric signatures and
an explicit algorithm allow-list reject forged/unsigned tokens; header-only
bearers avoid URL/proxy leakage; short access-token lifetimes limit theft
impact; one-time pairing and refresh rotation address code/token replay; device
unlink is the user-facing kill switch. This in-memory slice does not provide
durable storage, multi-process revocation propagation, login/consent, client
registration, key rotation, rate limits, or recovery from a lost device.

Still not implemented here:

- production authorization-server registration, login, consent, client metadata, key rotation operations or billing (the local token issuance and revocation adapter is test-only/private-development code);
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

## Readiness checklist

- [x] Local OAuth integration rejects unsigned/forged, expired, not-yet-valid,
  wrong-issuer, wrong-audience, and under-scoped JWTs.
- [x] Bearer tokens are header-only; token-shaped query parameters are rejected;
  request logs contain only route/method/status/duration/bounded size metadata.
- [x] Canonical resource URI, HTTPS-only hosted configuration, JWKS URL, issuer,
  scope, TLS file, and endpoint consistency are validated before hosted start.
- [x] Local stdio/MCPB entrypoint remains separate and unchanged by remote auth.
- [x] No raw Evidence is written by the remote handler; the hosted mode contract
  remains `no-go` until infrastructure retention controls are verified.
- [x] Deployment env template exists at
  [`remote-mcp.env.example`](remote-mcp.env.example); it contains no secrets.
- [x] Local pairing, audience-bound short access tokens, scopes, expiry,
  refresh rotation, device unlink, access-token revocation, and replay tests.
- [ ] Choose and configure a production authorization server with client
  registration/CIMD, consent, durable revocation, key rotation, and DPA/data
  residency review.
- [ ] Obtain a domain, certificate automation, cloud account, deployment
  credentials, health checks, alerting, rate limits, and verified no-Evidence
  retention at every proxy/log/trace/queue boundary.
- [ ] Finalize hosted identifier/account retention and update the public privacy
  policy before exposing a remote endpoint.

The unchecked items are production blockers. No authorization server, cloud
account, domain, certificate, or paid service was selected or purchased here.
