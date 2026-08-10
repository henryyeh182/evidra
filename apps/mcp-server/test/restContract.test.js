import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const contract = JSON.parse(await readFile(new URL("../../../schemas/rest/fitness-api.v1.json", import.meta.url), "utf8"));

test("REST contract is a bounded v1 skeleton mapped to the six public MCP tools", () => {
  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.info.version, "v1");
  const operations = Object.values(contract.paths).flatMap((path) => Object.values(path));
  assert.deepEqual(
    operations.map((operation) => operation["x-mcp-tool"]).sort(),
    ["assess_fitness_state", "commit_adjust_plan", "decide_exercise_substitution", "decide_session", "generate_plan", "preview_adjust_plan"].sort()
  );
  assert.ok(contract.paths["/v1/plans/{planId}/commits"].post.parameters.some((item) => item["$ref"].endsWith("/IdempotencyKey")));
  assert.equal(contract.components.securitySchemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(contract["x-privacy"].forbiddenLogs, ["request body", "tool arguments", "Evidence", "health values", "tokens", "JWT claims", "stable user identifiers"]);
  assert.deepEqual(contract["x-sdk-bindings"], ["typescript", "python", "swift", "kotlin"]);
});

test("REST problem details cannot grow an evidence-bearing payload by accident", () => {
  const problem = contract.components.schemas.ProblemDetails;
  assert.equal(problem.additionalProperties, false);
  assert.deepEqual(problem.required, ["type", "title", "status", "code", "detail", "requestId"]);
  assert.equal(problem.properties.evidence, undefined);
  assert.equal(problem.properties.token, undefined);
});
