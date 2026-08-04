# Database Schema

**This schema belongs to Phase 2 — the user-controlled private engine. It must never
run inside the hosted service.**

`raw_provider_events` stores provider payloads verbatim, and `health_metrics` stores
HRV, sleep, and resting heart rate. The Phase 1 hosted boundary forbids writing raw
Evidence to a database, file, object storage, queue, or analytics — so none of these
tables may exist there. Their only lawful home is an environment the user controls,
where storage, retention, and deletion are the user's own decisions.

Phase 1 hosted stays stateless: the caller holds the plan and passes it in with every
request (`get_plan` / `evidra_preview_adjust_plan` / `evidra_commit_adjust_plan` already work this way).

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

Some fields are intentionally `JSONB` for now:

- Preference values can be strings, numbers, booleans, or arrays.
- Injury restrictions are a list of semantic constraints.
- Workout muscle groups are a compact early representation before the graph database is added.
- Semantic state reasoning and goal alignment should remain structured but flexible.

These fields can be normalized later if query patterns demand it.

## Future Migrations

- **Add plan and planned workout tables.** A decision is a change to an existing plan
  (`from → to`), so the plan is the substrate every decision is made against. Until
  these tables exist, Phase 2 has a place to keep it but nothing built to keep it in.
- Add exercise prescription tables.
- Add audit logs and consent records.

The state → decision → outcome triple is **not** stored here on our behalf. The caller
keeps it and may pass it back as evidence; in Phase 2 the caller is the user's own
environment, so these tables are where it would live — owned by the user, not by us.

## Connector Events

The second migration adds the connector ingestion tables:

```text
connector_accounts
raw_provider_events
normalized_events
```

Raw events preserve provider payloads. Normalized events preserve the canonical event emitted by connector-specific normalizers before the data is materialized into `workouts` or `health_metrics`.
