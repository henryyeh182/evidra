# /eval — Offline Evaluation Harness

The quantitative discipline from the
[implementation plan](../docs/fitness-mcp-implementation-plan.md): every phase
must pass a golden set. This is the Phase 0 scaffold.

```
golden/v0.json        Golden query set (deterministic, model-free)
lib/jsonSchema.js     Dependency-free JSON Schema validator
lib/contracts.js      Loads /schemas contracts
lib/grounding.js      Known-id universe + grounding + plan/catalog coverage
runner.js             Drives the 8 tools through the JSON-RPC server, scores metrics
test/eval.test.js     node --test wrapper (fails CI if a gate regresses)
test/contract.test.js Contract drift guard (see /schemas)
```

## Run

```bash
npm run eval        # prints the scorecard, exits non-zero if a gate fails
npm test            # runs eval + contract tests alongside the rest of the suite
```

## Metrics

Gating (build fails below threshold):

| Metric | Gate | Meaning |
|---|---|---|
| Case pass rate | 100% | Every golden case's assertions hold |
| Schema validity | 100% | Every tool output validates against its `/schemas` output contract |
| Grounding rate | ≥ 99% | Every id-typed reference (`userId`, `goalId`, `planId`, `previewId`, `exercise_id`) resolves to a known id |
| Plan validity | 100% | Every generated / committed plan passes `assertValidPlan` |

Diagnostic (reported, non-gating):

- **Plan exercise → catalog coverage** — fraction of planned-workout exercise
  *names* that resolve to a real catalog exercise. Today this is partial by
  design: the planner emits free-form names (`"Romanian Deadlift"`) instead of
  grounded `exercise_id`s. This number is the live measurement of the **P3 / R1**
  gap and should climb toward 100% as Phase 1 data and Phase 2 read tools land.

## Not yet wired (needs a model runner)

`golden/v0.json` carries `query` + `expectedTool` on each case to seed a future
**tool-selection-accuracy** metric across GPT / Claude / Gemini. v0 does not
score it — it needs a model in the loop. The deterministic metrics above run
with zero external dependencies so they can gate every commit.

## Adding cases

Append to `golden/v0.json`. Cases run in order; `capture` stores an output value
(e.g. a freshly minted `planId`) for `{{var}}` substitution in later cases.
Target for the next iteration: grow to ~30 cases (Phase 0 goal), then ~50 once
the Phase 2 read tools exist.
