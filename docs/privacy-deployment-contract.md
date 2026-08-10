# Pacevera privacy deployment contract

> P0 contract, version 1, 2026-08-10.
>
> This document is the canonical boundary for product copy and implementation
> review. The machine-readable mode manifest is
> [`schemas/privacy/deployment-modes.json`](../schemas/privacy/deployment-modes.json).

Pacevera has three deployment modes. They are user-visible data boundaries, not
synonyms for the implementation phases in the roadmap:

| Mode | Status | Where Evidence is processed | What Pacevera may promise |
|---|---|---|---|
| `local-desktop` | available | The user's computer, in the shipped stdio bundle | Pacevera's desktop process does not fetch, persist, or log Evidence; the AI host and OS remain outside this promise |
| `user-controlled-private` | planned | A device, NAS, private network, or VPC controlled by the user or their organisation | Raw Evidence and provider tokens stay in that environment; its operator owns retention and deletion |
| `hosted-remote` | no-go | A Pacevera-operated HTTPS resource server, when eventually deployed | Only minimum Evidence is transiently processed; production requires the controls and policy below to be independently verified |

## Contract by mode

### `local-desktop`

- **Data flow:** the AI host sends a JSON-RPC tool call over stdio; Evidence is
  held in the Pacevera process for that call; the deterministic Decision is
  returned to the host. The shipped stdio entrypoint does not call providers or
  make outbound network requests.
- **Storage:** Pacevera has no database, cache, history, or log file in this
  mode. Evidence is process memory for the duration of the call. The host,
  operating system, terminal, backups, and imported files are not controlled by
  this contract.
- **Tokens:** no Pacevera account or provider OAuth token is accepted or stored
  by the desktop bundle. A user may still have tokens elsewhere on their
  machine; that is not evidence that Pacevera can access them.
- **Logging:** the process may emit startup/configuration status only. It must
  not emit tool arguments, request bodies, Evidence, health values, bearer
  tokens, JWT claims, or stable user identifiers. `stdio` has no access-log
  channel today.
- **Deletion:** call memory is released when the call completes or the process
  exits. There is no Pacevera-side deletion endpoint because this mode has no
  Pacevera-side durable record. The user deletes host conversations, exports,
  and OS backups separately if they want those removed.

The local HTTP transport in `apps/mcp-server/src/http.js` is not the desktop
bundle. If it is used, it is a separate local/private deployment and must be
bound to loopback or protected with an operator-supplied token and origin
allow-list. It must not be described as the no-network desktop bundle.

### `user-controlled-private`

- **Data flow:** source connectors, normalization, the decision engine, and the
  MCP server run in the user's device/private network/VPC. AI hosts receive
  only the output needed for the current interaction.
- **Storage:** `packages/db` may persist raw provider events, normalized
  events, health metrics, plans, and semantic state, but only in the
  user-controlled environment. The operator chooses encryption, retention,
  backups, access control, and deletion.
- **Tokens:** provider OAuth refresh tokens belong in the user's secret store
  or connector boundary. They must not be sent to a Pacevera-hosted resource
  server. The current repository has the schema and design target, not a
  completed private engine or token store.
- **Logging:** the operator may keep operational logs, but logs, traces, and
  error telemetry must exclude raw Evidence, tool arguments, request bodies,
  provider tokens, JWTs, health values, and stable user identifiers unless a
  separately reviewed governance policy explicitly permits a field.
- **Deletion:** the user or organisation deletes the local database, files,
  backups, connector secrets, and logs according to its retention policy. A
  hosted Pacevera deletion request cannot delete data that never crossed this
  boundary.

### `hosted-remote`

- **Data flow:** an authenticated client or user-controlled gateway sends the
  minimum Evidence required for one decision to the Pacevera HTTPS MCP
  endpoint. The service computes and returns Decision/Action/Reason. It does
  not connect to Apple Health, Garmin, Strava, or another provider.
- **Storage:** the application is stateless. Raw Evidence, tool arguments,
  output payloads, and decision history must not be written to a database,
  file, object store, queue, analytics system, cache, or trace. Any platform
  or authorization-server retention must be specified in the hosted privacy
  policy before production.
- **Tokens:** the resource server accepts a bearer access token in the
  `Authorization` header and verifies signature, issuer, audience, expiry, and
  scope. It never accepts a provider refresh token. Access-token issuance and
  revocation belong to the external authorization server; Pacevera must not
  log the token or its raw JWT claims.
- **Logging:** only operational metadata such as route, method, status,
  duration, and bounded request size may be logged. Request bodies, tool
  arguments, Evidence, health values, authorization headers, tokens, JWT
  claims, and stable user identifiers are forbidden. The application logger
  in this repository receives only this safe metadata when configured.
- **Deletion:** transient request memory is released after the response or an
  error. There is no Evidence deletion endpoint because the application must
  not persist it. The user manages host-side copies and authorization-server
  account/token records; any hosted operational or billing records need a
  separately documented retention/deletion process.

Hosted remote remains **no-go** until an end-to-end deployment proves the
application, load balancer, APM, error reporter, queue, object store, and
authorization server obey the same boundary. The existing HTTPS/JWKS code is a
resource-server readiness scaffold, not that proof.

## Verification requirements

Every release claiming a mode must pass the mode-specific checks in the
machine-readable manifest and the corresponding tests:

1. An injected HTTP logger sees only safe request metadata, never body,
   arguments, Evidence, Authorization, or JWT claims.
2. Query-string bearer tokens are rejected; forged, expired, wrong-audience,
   and under-scoped tokens fail closed.
3. The desktop bundle remains the stdio entrypoint and contains no HTTP/JWKS
   transport code.
4. Hosted deployment review confirms no durable Evidence sink and documents
   infrastructure-level log/trace retention before changing `hosted-remote`
   from `no-go`.

