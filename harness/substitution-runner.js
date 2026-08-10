// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Decision Harness for evidra_decide_exercise_substitution.
 *
 * This is deliberately separate from the evidence-driven session harness:
 * the catalog is the evidence here, and EVD-R-012 is a candidate filter rather
 * than a session arbitration rule.
 */

import assert from "node:assert/strict";

import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";
import { getRule } from "../packages/rules/src/index.js";

export const SUBSTITUTION_SCENARIOS = [
  {
    id: "knee-filter-removes-candidates",
    args: {
      exerciseId: "back squat",
      avoidContraindications: ["knee"],
      availableEquipment: ["bodyweight", "dumbbell", "barbell", "squat_rack"]
    },
    expect: { original: "exercise_back_squat", rule: true, type: "substitute" }
  },
  {
    id: "equipment-filter-does-the-work",
    args: {
      exerciseId: "back squat",
      avoidContraindications: ["knee"],
      availableEquipment: ["bodyweight", "dumbbell"]
    },
    expect: { original: "exercise_back_squat", rule: false, type: "substitute" }
  },
  {
    id: "no-safe-substitute-stays-put",
    args: {
      exerciseId: "front squat",
      avoidContraindications: ["knee"],
      availableEquipment: ["none"]
    },
    expect: { original: "exercise_front_squat", rule: false, type: "keep" }
  }
];

async function call(args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "evidra_decide_exercise_substitution", arguments: args }
    })
  );
  assert.equal(response.error, undefined, "substitution call failed at the protocol level");
  assert.equal(response.result.isError, undefined, "substitution call returned a tool error");
  return JSON.parse(response.result.content[0].text);
}

function assertDecision(record, scenario) {
  const { action, decision, decisionBasis: basis, evidence, alternatives = [], reason, confidence, limits = [] } = record;
  const expectedRule = getRule("EVD-R-012");

  assert.ok(basis, `${scenario.id}: decisionBasis is required`);
  assert.equal(basis.appliedRules.length, scenario.expect.rule ? 1 : 0, `${scenario.id}: rule count`);
  assert.equal(basis.governingRule?.ruleId ?? null, scenario.expect.rule ? "EVD-R-012" : null);
  assert.deepEqual(action.from.exercise_id, scenario.expect.original);
  assert.equal(action.from.exercise_id === action.to?.exercise_id, false, `${scenario.id}: replacement must differ`);
  const offeredIds = [action.to?.exercise_id, ...alternatives.map((item) => item.exercise_id)].filter(Boolean);
  assert.equal(new Set(offeredIds).size, offeredIds.length, `${scenario.id}: offered ids must be unique`);
  assert.ok(alternatives.length <= 2, `${scenario.id}: handler promises at most two alternatives`);
  assert.ok(reason.length > 0, `${scenario.id}: decision needs a reason`);

  const originalEvidence = evidence.find((item) => item.signal === "exercise.contraindications");
  assert.ok(originalEvidence, `${scenario.id}: original contraindications must be evidence`);
  assert.ok(basis.policies?.arbitration, `${scenario.id}: policies must travel with the basis`);

  if (scenario.expect.rule) {
    const governing = basis.governingRule;
    assert.deepEqual(
      governing.thresholds,
      expectedRule.thresholds,
      `${scenario.id}: reported threshold must match the rule library`
    );
    assert.equal(governing.basis, "internal_composite");
    assert.deepEqual(governing.sources, []);
    assert.ok(governing.measured.excluded.length > 0, `${scenario.id}: rule must name excluded candidates`);
    const excluded = new Set(governing.measured.excluded.map((item) => item.id));
    assert.equal(excluded.has(action.to?.exercise_id), false, `${scenario.id}: excluded choice was offered`);
    for (const alternative of alternatives) assert.equal(excluded.has(alternative.exercise_id), false);
    assert.ok(
      governing.measured.excluded.some((item) => reason.some((line) => line.includes(item.name))),
      `${scenario.id}: the reason must surface what the filter removed`
    );
  } else {
    assert.deepEqual(basis.appliedRules, [], `${scenario.id}: no rule should mean no applied trace`);
  }

  if (scenario.expect.type === "substitute") {
    assert.equal(decision.type, "substitute");
    assert.deepEqual(action.changed, ["exercise"]);
    assert.ok(action.to?.exercise_id);
    assert.notEqual(confidence, "low");
  } else {
    assert.equal(decision.type, "keep");
    assert.equal(action.to, null);
    assert.deepEqual(action.changed, []);
    assert.equal(confidence, "low");
    assert.ok(limits.length > 0);
  }
}

export async function runSubstitutionHarness() {
  const results = [];
  for (const scenario of SUBSTITUTION_SCENARIOS) {
    const first = await call(scenario.args);
    const second = await call(scenario.args);
    assert.deepEqual(second, first, `${scenario.id}: same catalog input must be deterministic`);
    assertDecision(first, scenario);
    results.push({ scenario, result: first });
  }

  assert.ok(
    results.some(({ result }) => result.decisionBasis.governingRule?.ruleId === "EVD-R-012"),
    "EVD-R-012 must fire in at least one substitution scenario"
  );
  assert.ok(
    results.some(({ result }) => result.decisionBasis.governingRule === null),
    "the harness must also exercise the no-filter path"
  );
  return results;
}

if (process.argv[1]?.endsWith("substitution-runner.js")) {
  await runSubstitutionHarness();
  console.log(`Substitution Decision Harness: ${SUBSTITUTION_SCENARIOS.length} scenarios passed.`);
}
