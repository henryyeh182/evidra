# Decision Trace and Outcome Tools

This slice adds three public tools and one internal rule primitive:

| Interface | Purpose | Current persistence |
|---|---|---|
| `get_evidence_coverage` | Report deterministic coverage, quality band, sources and missing signals | none |
| `explain_decision` | Read Decision → Rule → Evidence → Source → Version trace by `decisionId` | bounded process-local store, 15-minute TTL / 256 records |
| `submit_outcome` | Normalize an observed result into an outcome event | bounded process-local count; caller/private engine must persist the event |
| `resolveConflict` | Internal Layer 4 arbitration wrapper | none |

`decide_session` now returns `decisionId`. Its trace uses the decision's existing
`decisionBasis`, including rule, threshold, source and engine/rule-library
versions. The trace store deliberately does not claim to be a durable database:
it is an interface-first MVP for local/manual feedback loops.

## Boundary

The hosted/stateless deployment must not turn these tools into a personal
history service. Durable `decision_records` and `outcome_records` belong in the
user-controlled private engine (`packages/db`). The next durable slice should
inject a repository adapter into `decisionRecords.js` rather than changing the
MCP contracts.

`get_evidence_coverage` uses a transparent initial rubric. `coverageScore` is
signal availability only; `quality` is a band, not a scientific probability.
Unstated evidence basis is reported as a warning rather than converted into a
made-up numeric quality score.
