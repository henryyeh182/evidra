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
- PostgreSQL core schema
- Database row mappers
- Persistence repository contract

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

- Add a real PostgreSQL adapter.
- Split seed data by entity type.
- Add Apple Health export import prototype.
- Add Strava normalized activity fixture.
- Add MCP server in Phase 2.

## Data Layer Progress

The first migration lives at:

```text
packages/db/migrations/0001_core_domain.sql
```

The current implementation does not require a live database yet. Instead, `packages/db/src/mappers.js`
converts the sample user context and generated semantic fitness state into database-shaped rows.

This keeps Phase 1 testable while preserving a clean path to PostgreSQL, Prisma, Drizzle, or a direct
`node-postgres` adapter.
