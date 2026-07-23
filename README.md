# Fitness MCP

Fitness MCP is a model-agnostic personal fitness intelligence layer exposed through MCP.

It normalizes data from Apple Health, Garmin Connect, Strava, Oura, WHOOP, and other fitness platforms into a unified Semantic Fitness Layer that ChatGPT, Claude, Gemini, Cursor, VS Code, and future AI clients can query consistently.

## Core Idea

LLMs should not each re-analyze raw wearable and workout data.

Fitness MCP computes durable semantic state:

- Recovery score
- Readiness score
- Training load
- Muscle fatigue
- Injury constraints
- Goal alignment
- Recommended workout focus
- Recommendation reasoning
- Plan adaptation decisions

AI clients then query this state through stable MCP tools.

## Product Direction

Fitness MCP is not just a workout planner. It is the foundation for a cross-platform AI fitness operating layer.

The long-term goal is to connect fragmented health and training sources into one trusted semantic model, then expose that model to any AI assistant or app.

## Planned Components

- MCP server
- Semantic Fitness Layer
- Fitness Knowledge Graph
- Connector framework
- Workout recommendation engine
- Adaptive planning engine
- Web dashboard
- Security, consent, and audit layer

## Documentation

- [Implementation Plan](docs/implementation-plan.md)
- [GitHub Project](https://github.com/users/henryyeh182/projects/1)
- [Issue Backlog](https://github.com/henryyeh182/fitness-mcp/issues)

## MVP Target

The first MVP should allow an MCP client to ask:

> What should I do today?

And receive a structured answer based on the user's semantic fitness state, including readiness, fatigue, training load, constraints, recommendation, and reasoning.

## Local Demo Commands

```bash
npm test
npm run demo:mcp
npm run demo:semantic-state
npm run demo:strava
```

## MCP Server MVP

The first MCP server MVP lives in `apps/mcp-server`.

It currently supports JSON-RPC over stdio-compatible line messages:

- `initialize`
- `tools/list`
- `tools/call`

Core tools:

- `get_semantic_fitness_state`
- `recommend_today_workout`
- `get_training_context`

Run a local tool demo:

```bash
npm run demo:mcp
```

Run the stdio server directly:

```bash
node apps/mcp-server/src/stdio.js
```

## Repository Status

This repository is currently in planning and foundation setup.
