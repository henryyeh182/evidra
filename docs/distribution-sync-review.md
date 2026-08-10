# Registry and aggregator follow-up

Checked: 2026-08-10 (Asia/Taipei)

## Official MCP Registry

Live read-only lookup:

```text
GET https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.henryyeh182%2Fevidra&version=latest
```

Observed metadata:

| Field | Observed value |
|---|---|
| name | `io.github.henryyeh182/evidra` |
| title | `Pacevera` |
| version | `0.4.2` |
| status | `active` |
| isLatest | `true` |
| package | MCPB / stdio |
| fileSha256 | `cd5a05403f958c3533794b1c6258d24fe413dcbe6a911439d4b714316e8f87eb` |
| publishedAt / updatedAt | `2026-08-10T03:06:08.617626Z` |

This matches the checked-in `server.json`. No republish, revoke, rename, or
identity change was performed.

## PulseMCP

The official registry documentation says aggregators consume the public,
read-only registry API. PulseMCP documents its sub-registry as read-only and
states that direct `POST /v0.1/publish` submission is not implemented. A live
request to PulseMCP on this date returned:

```text
401 Invalid or missing API key (X-API-Key)
```

Therefore Pacevera/Pacevera `0.4.2` synchronization into PulseMCP is **not
verified**. This is an access blocker, not evidence of absence. The safe next
step is to obtain the maintainer's Pulse tenant/API key or use Pulse's support
channel to request a read-only lookup/enrichment; do not submit a duplicate
server, create a second identity, or treat the unrelated `io.github.vitas/evidra`
listing as Pacevera.

## Recheck commands

These commands are intentionally read-only and should be run after access is
available:

```bash
curl -fsSL 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.henryyeh182%2Fevidra&version=latest'
curl -fsSL 'https://api.pulsemcp.com/v0.1/servers?search=io.github.henryyeh182%2Fevidra&version=latest' \
  -H 'X-API-Key: <maintainer-provided-key>' \
  -H 'X-Tenant-ID: <maintainer-provided-tenant>'
```

The official Registry's own aggregator guidance recommends periodic,
infrequent reads and cursor/`updated_since` sync. That means waiting for an
aggregator's next ingestion cycle is expected after an official publish; it is
not a reason to publish the same version again.
