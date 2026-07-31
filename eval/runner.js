import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";
import { resolveToolName } from "../apps/mcp-server/src/toolDefinitions.js";
import { assertValidPlan } from "../packages/planning/src/models.js";
import { validate } from "./lib/jsonSchema.js";
import { loadContract } from "./lib/contracts.js";
import { loadKnownIds, GroundingRegistry } from "./lib/grounding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GATES = {
  schemaValidityRate: 1,
  groundingRate: 0.99,
  planValidityRate: 1,
  casePassRate: 1,
  // Promoted from diagnostic once sessions began carrying canonical ids. It sat
  // at 62.5% while the planner authored its own exercise names; now that every
  // prescribed movement is an id, anything below 100% means a plan is
  // prescribing something the catalog cannot describe.
  planExerciseCatalogCoverage: 1
};

// ---- small helpers -------------------------------------------------------

function substitute(value, vars) {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{(\w+)\}\}$/);
    if (exact && exact[1] in vars) return vars[exact[1]];
    return value.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitute(item, vars));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  }
  return value;
}

function getByPath(root, path) {
  const tokens = path.replace(/^\$\.?/, "").match(/[^.[\]]+/g) || [];
  let node = root;
  for (const token of tokens) {
    if (node == null) return undefined;
    node = node[token];
  }
  return node;
}

function isNonEmpty(value) {
  if (value == null) return false;
  if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value) || value === 0;
}

function evaluateAssertion(payload, assertion, vars) {
  const actual = getByPath(payload, assertion.path);
  const expected = substitute(assertion.value, vars);
  switch (assertion.op) {
    case "equals":
      return { ok: actual === expected, detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
    case "nonEmpty":
      return { ok: isNonEmpty(actual), detail: `expected non-empty at ${assertion.path}` };
    case "isArray":
      return { ok: Array.isArray(actual), detail: `expected array at ${assertion.path}` };
    case "isNumber":
      return { ok: typeof actual === "number", detail: `expected number at ${assertion.path}` };
    case "minLength":
      return { ok: (actual?.length ?? -1) >= expected, detail: `expected length >= ${expected} at ${assertion.path}, got ${actual?.length}` };
    default:
      return { ok: false, detail: `unknown assertion op: ${assertion.op}` };
  }
}

async function callTool(tool, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } })
  );
  if (response.error) {
    return { ok: false, error: response.error };
  }
  const text = response.result?.content?.[0]?.text;
  const payload = JSON.parse(text);

  // A result carrying `isError` is the tool saying it could not answer. It is a
  // failed call as far as a golden case is concerned, even though the protocol
  // carried it as a result — otherwise "I need evidence" would score as a pass.
  if (response.result?.isError) {
    return { ok: false, error: { message: payload.message || payload.error }, payload };
  }
  return { ok: true, payload };
}

// ---- runner --------------------------------------------------------------

export async function runGoldenSet(goldenPath = join(__dirname, "golden/v0.json")) {
  const golden = JSON.parse(await readFile(goldenPath, "utf8"));
  const registry = new GroundingRegistry(await loadKnownIds());
  const vars = {};

  const caseResults = [];
  let schemaChecks = 0;
  let schemaPass = 0;
  let groundingRefs = 0;
  let groundingPass = 0;
  let planChecks = 0;
  let planPass = 0;
  const coverage = { total: 0, matched: 0, unmatched: new Set() };

  for (const testCase of golden.cases) {
    const tool = resolveToolName(testCase.call.tool); // canonical name for contracts / plan detection
    const args = substitute(testCase.call.arguments, vars);
    const failures = [];

    // Send the raw (possibly deprecated) name so the server's alias resolution
    // is exercised; use the resolved canonical `tool` for contracts and plan logic.
    const result = await callTool(testCase.call.tool, args);

    if (testCase.expect.ok === false) {
      if (result.ok) {
        failures.push("expected an error but the call succeeded");
      } else if (testCase.expect.errorContains && !String(result.error.message).includes(testCase.expect.errorContains)) {
        failures.push(`error "${result.error.message}" does not contain "${testCase.expect.errorContains}"`);
      }
      caseResults.push({ id: testCase.id, tool, passed: failures.length === 0, failures });
      continue;
    }

    if (!result.ok) {
      failures.push(`unexpected error: ${result.error.message}`);
      caseResults.push({ id: testCase.id, tool, passed: false, failures });
      continue;
    }

    const payload = result.payload;

    // 1. schema validity
    const schema = await loadContract(tool, "output");
    const validation = validate(payload, schema);
    schemaChecks += 1;
    if (validation.valid) {
      schemaPass += 1;
    } else {
      failures.push(`schema: ${validation.errors.slice(0, 3).join(" | ")}`);
    }

    // 2. capture variables (register minted ids for grounding)
    for (const [name, path] of Object.entries(testCase.capture || {})) {
      vars[name] = getByPath(payload, path);
      if (name === "planId") registry.register("plans", vars[name]);
      if (name === "previewId") registry.register("previews", vars[name]);
    }
    if (tool === "generate_plan") registry.register("plans", payload.id);

    // 3. grounding of id-typed references
    for (const ref of registry.checkPayload(payload)) {
      groundingRefs += 1;
      if (ref.grounded) groundingPass += 1;
      else failures.push(`grounding: ${ref.field}=${ref.id} (${ref.path}) is not a known id`);
    }

    // 4. plan validity + diagnostic exercise-catalog coverage
    const plan =
      tool === "commit_adjust_plan" ? payload.plan :
      tool === "generate_plan" || tool === "get_plan" ? payload :
      null;
    if (plan) {
      planChecks += 1;
      try {
        assertValidPlan(plan);
        planPass += 1;
      } catch (error) {
        failures.push(`plan-validity: ${error.message}`);
      }
      const cov = registry.checkPlanExerciseCoverage(plan);
      coverage.total += cov.total;
      coverage.matched += cov.matched;
      cov.unmatched.forEach((name) => coverage.unmatched.add(name));
    }

    // 5. assertions
    for (const assertion of testCase.expect.assertions || []) {
      const evaluated = evaluateAssertion(payload, assertion, vars);
      if (!evaluated.ok) failures.push(`assert: ${evaluated.detail}`);
    }

    caseResults.push({ id: testCase.id, tool, passed: failures.length === 0, failures });
  }

  const casesPassed = caseResults.filter((c) => c.passed).length;
  const rate = (pass, total) => (total === 0 ? 1 : pass / total);

  return {
    goldenName: golden.name,
    metrics: {
      casePassRate: rate(casesPassed, caseResults.length),
      schemaValidityRate: rate(schemaPass, schemaChecks),
      groundingRate: rate(groundingPass, groundingRefs),
      planValidityRate: rate(planPass, planChecks),
      planExerciseCatalogCoverage: rate(coverage.matched, coverage.total)
    },
    diagnostics: {
      unmatchedExerciseNames: [...coverage.unmatched]
    },
    counts: {
      cases: caseResults.length,
      casesPassed,
      groundingRefs,
      planChecks,
      exerciseNamesChecked: coverage.total
    },
    caseResults
  };
}

export function checkGates(metrics) {
  const failed = [];
  for (const [name, threshold] of Object.entries(GATES)) {
    if (metrics[name] < threshold) {
      failed.push(`${name} ${(metrics[name] * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`);
    }
  }
  return failed;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const report = await runGoldenSet();
  const { metrics, diagnostics, counts } = report;

  console.log(`\n${report.goldenName}`);
  console.log("=".repeat(report.goldenName.length));
  console.log(`Cases:              ${counts.casesPassed}/${counts.cases} passed`);
  console.log(`Case pass rate:     ${pct(metrics.casePassRate)}   (gate 100%)`);
  console.log(`Schema validity:    ${pct(metrics.schemaValidityRate)}   (gate 100%)`);
  console.log(`Grounding rate:     ${pct(metrics.groundingRate)}   (gate >=99%, ${counts.groundingRefs} id refs)`);
  console.log(`Plan validity:      ${pct(metrics.planValidityRate)}   (gate 100%, ${counts.planChecks} plans)`);
  console.log(`Plan -> catalog:    ${pct(metrics.planExerciseCatalogCoverage)}   (gate 100%, ${counts.exerciseNamesChecked} refs)`);
  if (diagnostics.unmatchedExerciseNames.length > 0) {
    console.log(`\n  Ungrounded exercise references: ${diagnostics.unmatchedExerciseNames.join(", ")}`);
  }

  const failedCases = report.caseResults.filter((c) => !c.passed);
  if (failedCases.length > 0) {
    console.log(`\nFailed cases:`);
    for (const c of failedCases) {
      console.log(`  [${c.id}] ${c.tool}`);
      c.failures.forEach((f) => console.log(`     - ${f}`));
    }
  }

  const gateFailures = checkGates(metrics);
  if (gateFailures.length > 0) {
    console.log(`\nGATES FAILED: ${gateFailures.join("; ")}\n`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll gates passed.\n`);
  }
}

// Run when invoked directly (node eval/runner.js), not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
