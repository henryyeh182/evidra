# /schemas — Contract Source of Truth

Three tiers, read in the order evidence actually travels:

```
sources/<vendor>.export.json    # a vendor's export file, as it really arrives
sources/<vendor>.api.json       # a vendor's API documents, as they really arrive
evidence/fitness-evidence.json  # the canonical vocabulary everything downstream sees
tools/<tool_name>.input.json    # arguments the client sends
tools/<tool_name>.output.json   # payload shape the server returns (inside content[0].text)
```

The two source suffixes are not cosmetic. `.export.json` describes a file the
athlete downloaded and handed over; `.api.json` describes JSON a caller already
fetched and passed in. **We fetch neither** — the difference is in what the
caller had to do to obtain it, and it shows up in the dialect: an export carries
sentinels and header-only files, an API reply carries absent members and
`score_state` gates.

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

### The vocabulary has two tracks, not one

This is the part most easily got wrong when adding a platform, so it is stated
here rather than left to be inferred from the enums:

```
healthMetrics[]      sleep_duration_hours · sleep_quality · hrv_ms
                     resting_hr_bpm · stress · steps
                     — things a sensor measured

vendorAssessments[]  vendor_readiness · body_battery
                     recovery_time_minutes · vendor_acute_load
                     — scores the device maker computed
```

They are separate arrays because they are separate kinds of claim, and because
the engine treats them differently: vendor composites carry **more** weight than
the raw signals underneath them (the maker had the sensor on the wrist and saw
inputs we never receive), and they have their own, much shorter freshness
windows — a readiness score describes today or it describes nothing.

The tempting simplification is to flatten every maker's composite into one
`RecoveryState` enum. Do not: Garmin's Body Battery is a depletion level, WHOOP's
recovery score is a next-day prediction and Oura's readiness is a morning
composite. They are not interchangeable readings of one quantity, and collapsing
them to `Low | Moderate | High` also throws away the resolution the rule library
needs — the readiness thresholds alone cut at 40, 60 and 85.

## Drift guard

`eval/test/contract.test.js` asserts every input contract still matches the live
server definition in `apps/mcp-server/src/toolDefinitions.js` (structural
comparison — types, properties, required, enums — tolerant of description text),
and that every tool has an output contract. Output contracts are additionally
exercised against real tool responses by the golden-set runner, so a shape
change that isn't reflected here fails `node --test`.

The source and evidence tiers have their own guard, one per platform:
`packages/connectors/test/<vendor>.test.js` validates a fixture against that
vendor's source schema and the parser's output against
`evidence/fitness-evidence.json`, and asserts that every signal the registry
declares for the vendor is one the parser actually produces — a mapping table
that promises more than the code delivers fails the build.

The scenarios in [`eval/scenarios`](../eval/scenarios) run the same join over
whole document shapes rather than single fixtures, and they catch what a fixture
cannot. One example worth keeping in mind when writing a new source schema: a
WHOOP scenario set an unscored record's `score` to `undefined`, and
`sources/whoop.api.json` rejected it — JSON replies have absent members, not
undefined ones, so the scenario was describing a shape no API could return.

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
