# Form 2 ChatGPT MCP App Feasibility Spike

> Scope: prove the ChatGPT path can see and call the existing Evidra HTTP MCP
> server. This is not a commercial remote launch, not OAuth completion, and not
> a privacy-policy rewrite.

## Goal

Prove this chain:

```text
ChatGPT -> Secure MCP Tunnel -> local Evidra HTTP MCP -> 6 tools scan and call
```

The spike is complete only when ChatGPT can scan the six core public decision
tools and at least one decision call returns `decisionBasis` with the expected
rule trace.

## Current Facts

- `dist/evidra.mcpb` is a Claude Desktop bundle. ChatGPT does not install that
  file directly.
- Evidra already has a Streamable HTTP MCP endpoint: `npm run serve:http`,
  defaulting to `http://127.0.0.1:8787/mcp`.
- The HTTP server is stateless and has `/health`, which is useful behind a
  tunnel.
- Official OpenAI guidance says ChatGPT connects to remote MCP servers; local,
  private-network, or developer-machine MCP servers require Secure MCP Tunnel.
- Full MCP apps in ChatGPT are currently plan/surface dependent. Treat this as
  a developer-mode test, not a public distribution channel.

Source checked 2026-08-09:
https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt

## Non-Goals

- Do not build the authorization server.
- Do not expose a public HTTPS production endpoint.
- Do not change data retention behavior.
- Do not rewrite the hosted privacy policy.
- Do not add any direct Apple Health, Garmin, Strava, Oura or Whoop fetch path.
- Do not use `.mcpb` as the ChatGPT artifact; it remains the Claude Desktop
  package.

## Acceptance Criteria

### A. Local HTTP MCP Readiness

- `npm run serve:http` starts on loopback.
- `GET /health` returns status ok.
- MCP `initialize` succeeds over HTTP.
- MCP `tools/list` includes these six core decision tools, with no deprecated
  `evidra_`-prefixed names (v0.4.1+ dropped the prefix from the public
  surface; canonical internal names are unaffected):
  - `assess_fitness_state`
  - `decide_session`
  - `decide_exercise_substitution`
  - `generate_plan`
  - `preview_adjust_plan`
  - `commit_adjust_plan`
  The server currently advertises 10 public tools in total — the six above
  plus 4 bounded support tools (`explain_decision`, `generate_workout`,
  `get_evidence_coverage`, `submit_outcome`) added after this spike doc was
  first written. This spike only exercises the six core decision tools.
- A call to `decide_session` with `examples/evidence-garmin-hard-day.json`
  and `examples/scheduled-session.json` returns:
  - `decision.type = adjust`
  - `confidence = high`
  - `decisionBasis.governingRule.ruleId = EVD-R-002`

Run:

```bash
npm run spike:chatgpt:mcp
```

### B. Secure MCP Tunnel Scan

- Start Evidra locally:

```bash
npm run serve:http
```

- Start Secure MCP Tunnel from the OpenAI developer-mode flow and point it at:

```text
http://127.0.0.1:8787/mcp
```

- In ChatGPT developer mode, create a custom MCP app using the tunnel URL.
- Click Scan Tools.
- Scan finds the same six core decision tools (unprefixed names) and no
  deprecated `evidra_*` aliases.

### C. ChatGPT Tool Call

In a ChatGPT web chat with the dev app enabled, ask a prompt equivalent to:

```text
This is my Garmin evidence. Today's scheduled session is Tempo Run,
50 minutes, high intensity. Should I still do it?
```

Provide the Garmin sample evidence from `examples/evidence-garmin-hard-day.json`
and the scheduled session shape from `examples/scheduled-session.json`.

Expected evidence of success:

- ChatGPT calls `decide_session`.
- The structured result contains `decisionBasis`.
- The governing rule is `EVD-R-002`.
- ChatGPT's final answer does not override the returned intensity, duration or
  movement decision.

## Security Guardrails For The Spike

- Keep the local server bound to `127.0.0.1`.
- Do not set `MCP_HOST=0.0.0.0` for this spike.
- If a tunnel exposes the endpoint beyond the local machine, set a short-lived
  token:

```bash
MCP_TOKEN="$(openssl rand -hex 24)" npm run serve:http
```

- If the ChatGPT tunnel/app flow cannot send that bearer token, stop and record
  the blocker rather than running an unauthenticated public tunnel.

## Findings Template

Record the spike result in the implementation plan or a follow-up note:

```text
Date: 2026-08-13
ChatGPT plan/surface: not tested — Section B/C need a live ChatGPT developer-mode
  session and Secure MCP Tunnel, neither of which this run had access to.
Tunnel URL kind: not tested
Local endpoint: http://127.0.0.1:<ephemeral>/mcp (in-process, via `npm run spike:chatgpt:mcp`)
Scan tools result: N/A (no ChatGPT scan run) — local tools/list confirmed:
  10 public tools total, includes the 6 core decision tools unprefixed, no
  evidra_-prefixed names present.
Decision call result: PASS (Section A only) — decide_session with
  examples/evidence-garmin-hard-day.json + scheduled-session.json returned
  decision.type=adjust, confidence=high.
decisionBasis rule: EVD-R-002
Host respected returned action? N/A (no ChatGPT host involved in this run)
Blockers: Section A originally failed before this fix — the script and this
  doc's acceptance criteria still expected the pre-v0.4.1 tool list
  (6 tools, evidra_ prefix, exact-match tools/list). Fixed 2026-08-13:
  script now checks for the 6 unprefixed core tools as a subset of the
  current 10, and rejects any evidra_-prefixed name. Sections B and C are
  still unrun and need a real OpenAI developer-mode account + tunnel.
Next decision: run Sections B and C against a real ChatGPT developer-mode
  tunnel before claiming the chain in the Goal section is proven.
```

## Decision After Spike

If all three acceptance sections pass, Form 2 can move from "unknown feasibility"
to "technical path proven, commercial remote still NO-GO until OAuth / HTTPS /
privacy policy are completed."

If local HTTP passes but ChatGPT scan fails, the next work item is compatibility
with ChatGPT's MCP scanner, not Evidra decision-engine work.

If scan passes but tool call fails, inspect payload size, schema compatibility,
and ChatGPT's argument construction before changing the engine.
