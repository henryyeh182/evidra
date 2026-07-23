# Database Schema

This package contains the first PostgreSQL schema for Phase 1.

The schema intentionally models the core semantic pipeline before adding an ORM:

```text
users
  -> goals
  -> preferences
  -> injuries
  -> equipment
  -> workouts
  -> health_metrics
  -> semantic_fitness_states
```

## Design Notes

- `users` stores stable profile fields needed for coaching.
- `goals`, `preferences`, `injuries`, and `equipment` define constraints and personalization.
- `workouts` stores normalized completed workout records.
- `health_metrics` stores normalized time-series facts from Apple Health, Garmin, Strava, Oura, WHOOP, or manual input.
- `semantic_fitness_states` stores the computed daily state that MCP tools expose to AI clients.

## Why JSONB Exists Here

Some fields are intentionally `JSONB` in Phase 1:

- Preference values can be strings, numbers, booleans, or arrays.
- Injury restrictions are a list of semantic constraints.
- Workout muscle groups are a compact early representation before the graph database is added.
- Semantic state reasoning and goal alignment should remain structured but flexible.

These fields can be normalized later if query patterns demand it.

## Future Migrations

- Add plan and planned workout tables.
- Add exercise prescription tables.
- Add audit logs and consent records.

## Connector Events

The second migration adds the connector ingestion tables:

```text
connector_accounts
raw_provider_events
normalized_events
```

Raw events preserve provider payloads. Normalized events preserve the canonical event emitted by connector-specific normalizers before the data is materialized into `workouts` or `health_metrics`.
