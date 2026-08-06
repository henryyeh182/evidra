// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import {
  getRuleLibrary,
  getRule,
  describeRule,
  arbitrate,
  combineIntensitySteps,
  THRESHOLDS,
  assertValidRuleLibrary,
  assertThresholdsMatch
} from "../src/index.js";

const library = getRuleLibrary();
const clone = () => JSON.parse(JSON.stringify(library));

test("the shipped library satisfies its own invariants", () => {
  assert.doesNotThrow(() => assertValidRuleLibrary(clone()));
});

// The invariant this library exists for. A citation attached to a threshold on
// an Evidra-computed score would read as evidence-based to anyone who did not
// check it, and would not survive anyone who did — the paper never mentions the
// score. So the check is structural, not editorial.
test("a citation cannot be attached to a threshold on a score Evidra invents", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "internal_composite");
  rule.sources.push({
    citation: "A real paper about readiness.",
    supports: "Readiness matters.",
    doesNotSupport: "Nothing."
  });

  assert.throws(
    () => assertValidRuleLibrary(tampered),
    /internal_composite.*source/is,
    "an internal_composite rule carrying a source must fail the load"
  );
});

test("an internal_composite rule cannot claim an evidence level above internal_heuristic", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "internal_composite");
  rule.evidenceLevel = "systematic_review";

  assert.throws(() => assertValidRuleLibrary(tampered), /evidenceLevel/i);
});

// Every citation in this library falls short of the threshold it is attached to
// in some way. Forcing `doesNotSupport` to be filled in means the shortfall has
// to be stated rather than left for a reader to discover.
test("a source must say what it does not support", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.sources.length > 0);
  delete rule.sources[0].doesNotSupport;

  assert.throws(() => assertValidRuleLibrary(tampered), /does NOT support/i);
});

test("an external_metric rule cannot ship without a source", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "external_metric");
  rule.sources = [];

  assert.throws(() => assertValidRuleLibrary(tampered), /no sources/i);
});

test("a rule with no limitations has not been reviewed", () => {
  const tampered = clone();
  tampered.rules[0].limitations = [];

  assert.throws(() => assertValidRuleLibrary(tampered), /limitations/i);
});

// Both directions, because either one alone lets the library drift into
// decoration: a number nobody declares, or a rule nobody applies.
test("a threshold the engine applies but no rule declares fails the load", () => {
  assert.throws(
    () => assertThresholdsMatch(library, [...Object.keys(THRESHOLDS), "someNewNumber"]),
    /no rule declares/i
  );
});

test("a rule the engine never reads fails the load", () => {
  assert.throws(
    () => assertThresholdsMatch(library, Object.keys(THRESHOLDS).slice(1)),
    /never reads/i
  );
});

test("arbitration puts category before priority", () => {
  // EVD-R-008 is training_goal with priority 40; EVD-R-005 is recovery with
  // priority 20. Priority alone would pick 008; category rank must not let it.
  const { governing, overruled } = arbitrate(["EVD-R-008", "EVD-R-005"]);

  assert.equal(governing.ruleId, "EVD-R-005", "a lower-priority recovery rule still outranks a training-goal rule");
  assert.deepEqual(
    overruled.map((entry) => entry.ruleId),
    ["EVD-R-008"]
  );
});

test("arbitration is stable for the same inputs in any order", () => {
  const a = arbitrate(["EVD-R-002", "EVD-R-006", "EVD-R-004"]);
  const b = arbitrate(["EVD-R-004", "EVD-R-002", "EVD-R-006"]);

  assert.deepEqual(a.ordered.map((entry) => entry.ruleId), b.ordered.map((entry) => entry.ruleId));
});

// Two devices reporting the same tired athlete is one fact observed twice.
// Summing the reductions would penalise a well-instrumented user for having
// more sensors.
test("intensity reductions do not sum", () => {
  assert.equal(combineIntensitySteps([1, 1, 1]), 1);
  assert.equal(combineIntensitySteps([1, 2]), 2);
});

test("a progression can never cancel a reduction", () => {
  assert.equal(combineIntensitySteps([1, -1]), 1);
  assert.equal(combineIntensitySteps([-1]), -1);
});

test("the compact rule form keeps basis and evidence level", () => {
  // These two fields are the disclosure. If size pressure ever trims the
  // compact form further, it must not trim these.
  const compact = describeRule("EVD-R-006", { value: 2.1 }, { full: false });

  assert.equal(compact.basis, "external_metric");
  assert.equal(compact.evidenceLevel, "observational");
  assert.ok(compact.contestedCount > 0, "the compact form still says objections exist");
  assert.equal(compact.sources, undefined, "the compact form does not carry full citations");
});

test("the acute:chronic rule ships its own published objections", () => {
  const rule = getRule("EVD-R-006");
  const described = describeRule("EVD-R-006");

  assert.ok(rule.sources.length > 0);
  assert.ok(
    described.contested.length >= 2,
    "citing Gabbett without citing the published criticism would misrepresent the field"
  );
  assert.ok(
    described.limitations.some((line) => line.includes("1.4")),
    "the limitation that our threshold is not the literature's must be stated"
  );
});

test("every threshold in the library is reachable from a rule that owns it", () => {
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    const owner = library.rules.find((rule) => rule.thresholds.some((entry) => entry.key === key));
    assert.ok(owner, `${key} has no owning rule`);
    const threshold = owner.thresholds.find((entry) => entry.key === key);
    assert.equal(threshold.value, value, `${key} disagrees with the value the engine reads`);
  }
});
