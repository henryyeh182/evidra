# MCP Server MVP

The MCP Server MVP exposes the Semantic Fitness Layer as tool calls.

This first implementation is intentionally dependency-free. It implements a small JSON-RPC dispatcher that mirrors the MCP tool flow:

```text
initialize
tools/list
tools/call
```

The tool handlers are isolated from transport details so the project can later swap in the official MCP SDK without rewriting the domain logic.

## Tools

### `get_semantic_fitness_state`

Returns the computed Semantic Fitness State for a user and date.

Arguments:

```json
{
  "userId": "user_henry_demo",
  "date": "2026-07-23"
}
```

### `recommend_today_workout`

Returns today's recommended focus, scores, constraints, and reasoning.

Arguments:

```json
{
  "userId": "user_henry_demo",
  "date": "2026-07-23",
  "includeStravaFixture": true
}
```

### `get_training_context`

Returns profile, goals, preferences, active injuries, available equipment, workout count, health metric count, exercise catalog count, and latest workout.

Arguments:

```json
{
  "userId": "user_henry_demo",
  "includeStravaFixture": true
}
```

## Local Commands

```bash
npm run demo:mcp
node apps/mcp-server/src/stdio.js
```

## Example Client Config

See:

```text
docs/mcp-client-config.example.json
```

Replace `/absolute/path/to/fitness-mcp` with the local repo path before using it in an MCP client.

## Next Steps

- Replace demo data loading with a repository adapter.
- Add official MCP SDK once dependency installation is available.
- Add write-safe tool patterns for plan preview and commit.
- Add authentication and user/session resolution.
