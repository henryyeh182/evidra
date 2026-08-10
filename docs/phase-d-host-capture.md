# Phase D — host handoff capture

This is the remaining C6 check. Existing tests replay the observed Claude
Desktop → Evidra contract, but they do not contain the preceding response from
another MCP server. Do not close C6 using a hand-written canonical evidence
object: that proves only the final contract.

## Required capture

Save one de-identified JSON capture with:

```json
{
  "capture": {
    "source": "third-party MCP server name",
    "capturedAt": "2026-08-09",
    "redacted": true
  },
  "thirdPartyResult": {
    "tool": "the source server tool name",
    "result": "the raw result returned to the host"
  },
  "hostCall": {
    "tool": "evidra_assess_fitness_state",
    "arguments": {
      "date": "2026-08-09",
      "evidence": "the exact evidence object sent by the host"
    }
  }
}
```

The capture must remove names, IDs, tokens, raw timestamps where unnecessary,
and health values that are not needed for the shape check. Keep the vendor
field names in `thirdPartyResult`; that is what makes this a handoff test.

Replay it with:

```bash
node scripts/replay-host-handoff.js /path/to/capture.json
```

The runner calls the real local MCP server and requires the result to be
classified as `provenance.evidenceSource: "provided"`. Until such a capture is
available, C6 remains partially closed.
