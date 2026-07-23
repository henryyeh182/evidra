# Phase 1: Core Domain And Local Data

Phase 1 turns the Fitness MCP plan into a runnable local foundation.

## Goals

- Define the first core domain model.
- Add seed data for a realistic sample user.
- Generate an initial Semantic Fitness State without external services.
- Prove the recommendation pipeline can produce deterministic output.
- Keep the implementation dependency-free until the architecture is stable.

## Current Scope

Included:

- User profile
- Goals
- Preferences
- Injuries
- Equipment
- Workout history
- Health metric history
- Exercise seed data
- Semantic state generator
- Daily workout focus recommendation
- Explanation trace
- Node test coverage

Excluded for now:

- MCP server
- Real database persistence
- OAuth connectors
- Web dashboard
- Production auth

## Local Commands

```bash
npm test
npm run demo:semantic-state
```

## Next Phase 1 Tasks

- Add persistent PostgreSQL schema.
- Split seed data by entity type.
- Add Apple Health export import prototype.
- Add Strava normalized activity fixture.
- Add MCP server in Phase 2.
