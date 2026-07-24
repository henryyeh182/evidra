# Phase 5: Planning Engine

Phase 5 adds a deterministic, dependency-free planning engine on top of the
semantic foundation from earlier phases. It turns a user's goals and constraints
into a periodized multi-week training plan and supports safe, previewable edits.

## Goals

- Generate a multi-week training plan from the user's primary goal.
- Apply availability, equipment, injury, and preference constraints.
- Preview a plan change before committing it.
- Commit a change as a new plan version.
- Keep a version history for every plan.
- Stay dependency-free and fully testable.

## Package

The engine lives in `packages/planning`:

```text
packages/planning/src/generatePlan.js   Periodized plan generation from goal + constraints
packages/planning/src/adaptPlan.js      Non-destructive change previews (diff + resulting plan)
packages/planning/src/planStore.js      In-memory versioned plan store (preview -> commit)
packages/planning/src/models.js         Plan / change-request typedefs and validators
```

## How Generation Works

1. Constraints are derived from the user context: weekday available minutes,
   available equipment, active injury restrictions, and avoided movements.
2. A weekly template is selected from the highest-priority goal
   (`half_marathon`, `build_muscle`, `general_fitness`, `recovery`).
3. Each week is assigned a periodization phase — `base` → `build` → `peak` →
   `deload` — with a matching load multiplier.
4. Every session is trimmed to the availability cap, has high-impact intensity
   downgraded when an injury restriction applies, and drops exercises whose
   equipment is unavailable or that the user avoids.
5. Each session carries a `rationale` string, and the plan carries a top-level
   `reasoning` trace, so recommendations stay explainable.

Generation is deterministic: the same context and start date always produce the
same plan, which keeps it golden-testable.

## Change Requests

`preview_plan_change` supports three change kinds and never mutates the stored
plan; it returns a diff plus the resulting plan. `commit_plan_change` applies a
preview as a new version.

- `reduce_availability` — cap sessions to fewer minutes/day (e.g. a travel week).
- `add_injury` — add restrictions, downgrade intensity, and remove
  contraindicated exercises across the plan.
- `deload_week` — convert a specific week into a reduced-volume deload week.

A preview is validated against the plan version it was built from, so a stale
preview is rejected instead of silently overwriting newer changes.

## MCP Tools

The MCP server exposes the planning engine through five tools:

- `generate_training_plan`
- `get_training_plan`
- `list_training_plans`
- `preview_plan_change`
- `commit_plan_change`

Read and write tools are separated, and destructive changes require an explicit
`preview -> commit` step, matching the plan's MCP safety principles.

## Local Commands

```bash
npm test
npm run demo:planning
```

## Next Steps

- Persist plans in the Phase 1 PostgreSQL schema (add plan + planned-workout tables).
- Feed the daily Semantic Fitness State into generation for readiness-aware plans.
- Add plan generation that blends primary and secondary goals.
