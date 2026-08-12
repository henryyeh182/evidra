# Decision Trace and Outcome Tools

This slice adds three public tools and one internal rule primitive:

| Interface | Purpose | Current persistence |
|---|---|---|
| `get_evidence_coverage` | Report deterministic coverage, quality band, sources and missing signals | none |
| `explain_decision` | Read Decision → Rule → Evidence → Source → Version trace by `decisionId` | bounded process-local store, 15-minute TTL / 256 records |
| `submit_outcome` | Normalize an observed result into an outcome event | hosted MCP: bounded process-local count; local private engine: SQLite `outcome_records` via injected repository |
| `resolveConflict` | Internal Layer 4 arbitration wrapper | none |

`decide_session` now returns `decisionId`. Its trace uses the decision's existing
`decisionBasis`, including rule, threshold, source and engine/rule-library
versions. The trace store deliberately does not claim to be a durable database:
it is an interface-first MVP for local/manual feedback loops.

## Boundary

The hosted/stateless deployment must not turn these tools into a personal
history service. Durable `decision_records` and `outcome_records` belong in the
user-controlled private engine (`packages/db`). `outcome_records` and
`decision_records` now have SQLite adapters and the local MCP path injects them
without changing the MCP contract. The hosted path remains stateless. Backup,
export and deletion lifecycle operations remain to be added.

`get_evidence_coverage` uses a transparent initial rubric. `coverageScore` is
signal availability only; `quality` is a band, not a scientific probability.
Unstated evidence basis is reported as a warning rather than converted into a
made-up numeric quality score.

## LLM assistance boundary

LLM assistance is allowed only in two bounded roles:

1. Extract a literature-backed candidate into the `rule-candidate` draft schema.
2. Turn an already approved `decisionBasis`／Rule record into plain-language
   explanation for the user.

Candidate records are forced to `status: draft`, require source scope and
limitations, and are never loaded by the runtime Rule Library. Approval,
regression, versioning and release remain human-governed. The user explanation
renderer reads existing Rule metadata; it does not create a new Rule or alter a
decision.
