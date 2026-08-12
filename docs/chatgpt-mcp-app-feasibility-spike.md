# Form 2 ChatGPT MCP App Feasibility Spike

> Scope: prove the ChatGPT path can see and call the existing Evidra HTTP MCP
> server. This is not a commercial remote launch, not OAuth completion, and not
> a privacy-policy rewrite.

## Goal

Prove this chain:

```text
ChatGPT -> Secure MCP Tunnel -> local Evidra HTTP MCP -> 6 tools scan and call
```

The spike is complete only when ChatGPT can scan the six public `evidra_*`
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
- MCP `tools/list` returns exactly these six tools:
  - `evidra_assess_fitness_state`
  - `evidra_decide_session`
  - `evidra_decide_exercise_substitution`
  - `evidra_generate_plan`
  - `evidra_preview_adjust_plan`
  - `evidra_commit_adjust_plan`
- A call to `evidra_decide_session` with `examples/evidence-garmin-hard-day.json`
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
- Scan finds the same six `evidra_*` tools and no deprecated aliases.

### C. ChatGPT Tool Call

In a ChatGPT web chat with the dev app enabled, ask a prompt equivalent to:

```text
This is my Garmin evidence. Today's scheduled session is Tempo Run,
50 minutes, high intensity. Should I still do it?
```

Provide the Garmin sample evidence from `examples/evidence-garmin-hard-day.json`
and the scheduled session shape from `examples/scheduled-session.json`.

Expected evidence of success:

- ChatGPT calls `evidra_decide_session`.
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
Date:
ChatGPT plan/surface:
Tunnel URL kind:
Local endpoint:
Scan tools result:
Decision call result:
decisionBasis rule:
Host respected returned action? yes/no
Blockers:
Next decision:
```

## Decision After Spike

If all three acceptance sections pass, Form 2 can move from "unknown feasibility"
to "technical path proven, commercial remote still NO-GO until OAuth / HTTPS /
privacy policy are completed."

If local HTTP passes but ChatGPT scan fails, the next work item is compatibility
with ChatGPT's MCP scanner, not Evidra decision-engine work.

If scan passes but tool call fails, inspect payload size, schema compatibility,
and ChatGPT's argument construction before changing the engine.
