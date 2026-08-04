// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { toolDefinitions as defs, listedToolDefinitions } from "../../apps/mcp-server/src/toolDefinitions.js";
import { loadContract } from "../lib/contracts.js";
import { validate } from "../lib/jsonSchema.js";

// Reduce a schema to the parts that form the contract (type / properties /
// required / enum / items), dropping meta keys and descriptions so the file
// can carry $schema, $id, title, and richer descriptions without drifting.
function structural(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  if (schema.type !== undefined) out.type = schema.type;
  if (schema.enum !== undefined) out.enum = schema.enum;
  if (schema.required !== undefined) out.required = [...schema.required].sort();
  if (schema.properties) {
    out.properties = {};
    for (const key of Object.keys(schema.properties).sort()) {
      out.properties[key] = structural(schema.properties[key]);
    }
  }
  if (schema.items) out.items = structural(schema.items);
  return out;
}

test("every shipped tool has input and output contract files that match the server", async () => {
  for (const tool of defs) {
    const inputContract = await loadContract(tool.name, "input");
    assert.deepEqual(
      structural(inputContract),
      structural(tool.inputSchema),
      `input contract for ${tool.name} has drifted from the server definition`
    );

    const outputContract = await loadContract(tool.name, "output");
    assert.equal(typeof outputContract, "object", `${tool.name} output contract must be an object`);
    assert.ok(outputContract.type, `${tool.name} output contract must declare a type`);
  }
});

test("every advertised tool declares the output schema its contract file describes", async () => {
  // The contract files are what the eval runner validates real payloads against;
  // outputSchemas.js is the copy clients are told. `schemas/` stays out of the
  // packed bundle, so the server cannot read the file at runtime and the two
  // exist separately — which means the only thing keeping the copy clients see
  // honest is this assertion.
  for (const tool of listedToolDefinitions()) {
    assert.ok(tool.outputSchema, `${tool.name} is advertised without an output schema`);

    const contract = await loadContract(tool.name, "output");
    assert.deepEqual(
      structural(tool.outputSchema),
      structural(contract),
      `the output schema sent to clients for ${tool.name} has drifted from schemas/tools/${tool.name}.output.json`
    );
  }
});

test("the contract validator itself accepts a valid doc and rejects a bad one", async () => {
  const schema = await loadContract("list_plans", "output");
  assert.equal(validate({ userId: "u", plans: [] }, schema).valid, true);
  const bad = validate({ userId: 123 }, schema);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes("plans")));
});
