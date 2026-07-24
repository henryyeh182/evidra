# v2 Phase 1: Workout Knowledge Base

This phase follows the v2 implementation plan
([fitness-mcp-implementation-plan.md](fitness-mcp-implementation-plan.md)). Its
first principle is **Semantic Layer before MCP**: before exposing any more
tools, "exercise" has to become a semantic graph rather than a flat table, so
that questions like *"find a knee-friendly squat substitute"* are a single graph
traversal instead of an LLM guess.

## Package

`packages/knowledge-graph` is dependency-free and testable:

```text
src/models.js            Exercise node + edge typedefs, dataset integrity validation
src/graph.js             In-memory graph with substitution / progression / search traversals
src/workoutSchema.js     Block/Set workout structure, validation, structured search
src/programTemplates.js  Parameterized program templates expanded into grounded exercises
```

## Exercise Ontology

Each exercise node carries `primaryMuscle`, `secondaryMuscles`,
`movementPattern`, `equipment`, `planeOfMotion`, `unilateral`, `skillLevel`,
`impactLevel`, `loadsJoints`, `contraindications`, plus `source` and
`confidence` for provenance.

Exercise-to-exercise relationships are modelled as edges:

- `IS_VARIANT_OF`
- `PROGRESSES_TO` / `REGRESSES_TO`
- `SIMILAR_TO` (with a similarity `score` and the `dimensions` compared)
- `SUBSTITUTES_FOR_WHEN` (conditional: `knee_injury`, `no_equipment`, `limited_space`, ...)
- `ANTAGONIST_OF`

`REQUIRES_EQUIPMENT` and `LOADS_JOINT` are kept as node properties in this
dependency-free phase; they become edges once a graph database is introduced.

## Queries (the "DB layer")

- `findSubstitutes(id, { conditions, availableEquipment, avoidContraindications })`
  combines conditional substitutes, regressions, and similar movements, then
  filters by available equipment and injury contraindications.
- `searchExercises({ muscle, muscleGroup, movementPattern, availableEquipment, excludeContraindications, maxImpact, skillLevel })`
  answers structured queries Peloton could not — "upper body only", "no
  equipment", "low impact avoiding the knee".
- `searchWorkouts(workouts, graph, { inZone, maxDurationMinutes, availableEquipment, muscleGroup })`
  answers "entirely in Zone 2" and "no-equipment under 20 minutes".

## Workout Structure

Every workout decomposes into `Block[]` (warmup / main / accessory / cooldown),
each with `Set[]` (`exerciseId`, `reps`|`durationSeconds`, `intensity{type,value}`,
`restSeconds`, `tempo`). `assertValidWorkout(workout, graph)` enforces the schema
and — when given the graph — verifies every `exerciseId` exists, the server-side
grounding check (v2 principle P3) that stops hallucinated exercises.

## Program Templates

Templates are parameterized by movement pattern. `expandTemplate` resolves each
pattern against the graph under the user's constraints, returning grounded
exercise ids and flagging any `unmetPatterns`.

## Local Commands

```bash
npm test
npm run demo:knowledge
```

## Acceptance Criteria (v2) and Status

- Structured queries that Peloton cannot answer work at the data layer — **met**
  (`demo:knowledge` shows Zone-2-only, no-equipment, upper-only, knee-safe).
- Every plan/search item resolves to a real exercise id — **met** (grounding
  enforced in `assertValidWorkout` and `expandTemplate`).
- ≥ 800 exercise nodes / ≥ 3000 edges — **not met**: this phase ships the schema,
  traversals, and a representative ~23-node seed. Bulk data population (LLM
  pre-labelling + human review) is the remaining Phase 1 data work.

## Next Steps

- Grow the ontology toward the v2 node/edge targets with a review queue.
- v2 Phase 2: expose `search_exercises`, `get_exercise`, `search_workouts`,
  `get_workout` as read-only MCP tools over this graph.
