# /schemas — Tool Contract Source of Truth

JSON Schema is the contract for every MCP tool. Each shipped tool has two files
under [`tools/`](tools):

```
tools/<tool_name>.input.json    # arguments the client sends
tools/<tool_name>.output.json   # payload shape the server returns (inside content[0].text)
```

These support design principle **P1** (tools return structured data) and the
Phase 0 "schema-first" decision in the
[implementation plan](../docs/fitness-mcp-implementation-plan.md): the schema is
the cross-model contract.

## Drift guard

`eval/test/contract.test.js` asserts every input contract still matches the live
server definition in `apps/mcp-server/src/toolDefinitions.js` (structural
comparison — types, properties, required, enums — tolerant of description text),
and that every tool has an output contract. Output contracts are additionally
exercised against real tool responses by the golden-set runner, so a shape
change that isn't reflected here fails `node --test`.

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
