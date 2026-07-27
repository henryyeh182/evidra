# /schemas — Contract Source of Truth

Three tiers, read in the order evidence actually travels:

```
sources/<vendor>.export.json    # the vendor's own dialect, as it really arrives
evidence/fitness-evidence.json  # the canonical vocabulary everything downstream sees
tools/<tool_name>.input.json    # arguments the client sends
tools/<tool_name>.output.json   # payload shape the server returns (inside content[0].text)
```

These support design principle **P1** (tools return structured data) and the
Phase 0 "schema-first" decision in the
[implementation plan](../docs/fitness-mcp-implementation-plan.md): the schema is
the cross-model contract.

## sources/ — what each vendor actually sends

One file per platform we can read, written in the vendor's own field names.
These are documentation of a boundary, not an aspiration: every field is
optional and the holes are named, because a real export contains sentinels
(`level: "NONE"`, `restingHeartRate: 0`, `averageStressLevel: -1`) and missing
records rather than tidy nulls. Reading those literally is how an unworn watch
becomes a well-rested athlete.

Adding a platform means: a mapping in
[`packages/evidence/src/schemaRegistry.js`](../packages/evidence/src/schemaRegistry.js),
a source schema here, a parser under `packages/connectors`, and the scenarios in
[`eval/scenarios`](../eval/scenarios) that hold the three consistent.

## evidence/ — the canonical vocabulary

[`evidence/fitness-evidence.json`](evidence/fitness-evidence.json) is the output
contract of every connector and the input contract of every decision tool. Its
enums mirror `CANONICAL_SIGNALS` in the schema registry; a signal added in one
place must be added in the other. Vendor detail (Garmin's readiness level, a
Body Battery overnight low) may ride along as extra properties — the canonical
name, unit and source label are what is fixed.

## Drift guard

`eval/test/contract.test.js` asserts every input contract still matches the live
server definition in `apps/mcp-server/src/toolDefinitions.js` (structural
comparison — types, properties, required, enums — tolerant of description text),
and that every tool has an output contract. Output contracts are additionally
exercised against real tool responses by the golden-set runner, so a shape
change that isn't reflected here fails `node --test`.

The source and evidence tiers have their own guard:
`packages/connectors/test/garmin.test.js` validates the fixture against
`sources/garmin.export.json` and the parser's output against
`evidence/fitness-evidence.json`, and asserts that every signal the registry
declares for Garmin is one the parser actually produces — a mapping table that
promises more than the code delivers fails the build.

## Validation

`eval/lib/jsonSchema.js` is a small, dependency-free validator covering the
subset used here (`type`, `enum`, `const`, `properties`, `required`, `items`,
`additionalProperties`, `minimum`, `minItems`, `nullable`). Keep the repo
dependency-free: extend that validator rather than adding a JSON Schema library.

## Roadmap

- **Now (Phase 0):** contracts are extracted artifacts + drift guard.
- **Next:** flip the direction so `toolDefinitions.js` imports these files as the
  single source of truth (codegen), instead of mirroring them.
- **Tighten:** add `additionalProperties: false` to input contracts once every
  client is known to send only declared fields.
