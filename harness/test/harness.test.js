// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The harness, run as part of the suite.
 *
 * `npm run harness` prints a report for a person to read; this is the same run
 * with a failing exit attached to it, so a decision that stops holding together
 * shows up in `npm test` rather than only when someone remembers to look.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { runHarness, fingerprintDrift } from "../runner.js";
import { loadScenarios, runChain } from "../lib/chain.js";
import { CHECKS } from "../lib/checks.js";
import { handleJsonRpcMessage } from "../../apps/mcp-server/src/server.js";

test("every invariant holds across every scenario", async () => {
  const { scenarios, findings, errors } = await runHarness();

  assert.equal(errors.length, 0, `scenarios failed to run: ${errors.map((e) => `${e.scenario}: ${e.message}`).join("; ")}`);
  assert.ok(scenarios.length >= 13, "the scenario set should not shrink silently");

  assert.deepEqual(
    findings,
    [],
    `\n${findings.map((finding) => `  [${finding.check}] ${finding.scenario}: ${finding.failure}`).join("\n")}\n`
  );
});

test("no rule's threshold, category or effect has moved unacknowledged", async () => {
  // The rule this enforces: a change to a threshold, a category or an effect
  // must be run through the harness before it lands.
  //
  // It is enforced here rather than written down because the harness already
  // runs on every `npm test` — what it could not do was fail on the edits that
  // change no decision in this scenario set. Widening `acwrHigh` from 1.4 to
  // 1.6 moves the guarantee and moves no scenario across it, so every other
  // check stays green while the thing they exist to protect quietly shifts.
  //
  // What failing here means: run `npm run harness`, read what the decisions
  // became, then `node harness/runner.js --update-fingerprint` and commit that
  // with the rule edit. The regenerated file is the record that somebody looked.
  const drift = await fingerprintDrift();

  assert.deepEqual(
    { changed: drift.changed, added: drift.added, removed: drift.removed, policiesMoved: drift.policiesMoved },
    { changed: [], added: [], removed: [], policiesMoved: false },
    `\n  a rule that decides things changed and the harness has not been run against it:\n` +
      `${drift.changed.map((id) => `    ${id} changed\n`).join("")}` +
      `${drift.added.map((id) => `    ${id} is new\n`).join("")}` +
      `${drift.removed.map((id) => `    ${id} is gone\n`).join("")}` +
      `${drift.policiesMoved ? `    the arbitration or combination policy changed\n` : ``}` +
      `\n  npm run harness   # then: node harness/runner.js --update-fingerprint\n`
  );
});

test("the fingerprint watches what decides and ignores what does not", async () => {
  // A guard whose edges nobody can see gets widened by accident, so the edges
  // are asserted rather than described. Built from synthetic rules rather than
  // by editing a real one: the library is frozen, which is itself the right
  // answer and leaves this as the only way to ask the question.
  const { fingerprintRule } = await import("../lib/fingerprint.js");

  const base = {
    ruleId: "EVD-R-TEST",
    status: "active",
    category: "recovery",
    priority: 50,
    thresholds: [{ key: "someScore", operator: "<", value: 60, unit: "score" }],
    effect: { decision: "adjust", intent: "reduce_today_intensity", intensityStepsDown: 1 },
    title: "A title",
    notes: "Some notes",
    limitations: ["a limitation"],
    sources: []
  };
  const reference = fingerprintRule(base);

  // Outside: prose. A guard that fires when someone corrects a citation or
  // records a limitation is a guard that gets switched off.
  for (const [field, value] of [
    ["title", "A completely different title"],
    ["notes", "Rewritten notes"],
    ["limitations", ["a new limitation", "and another"]],
    ["sources", [{ citation: "Someone et al." }]]
  ]) {
    assert.equal(
      fingerprintRule({ ...base, [field]: value }),
      reference,
      `editing ${field} moved the fingerprint; prose must not`
    );
  }

  // Inside: everything that can change a decision.
  const decidingEdits = {
    "a threshold value": { thresholds: [{ ...base.thresholds[0], value: 65 }] },
    "a threshold operator": { thresholds: [{ ...base.thresholds[0], operator: "<=" }] },
    "the category": { category: "injury" },
    "the priority": { priority: 90 },
    "the effect": { effect: { ...base.effect, intensityStepsDown: 2 } },
    "the status": { status: "retired" }
  };
  for (const [what, edit] of Object.entries(decidingEdits)) {
    assert.notEqual(
      fingerprintRule({ ...base, ...edit }),
      reference,
      `${what} changed and the fingerprint did not notice`
    );
  }
});

test("a wrong pin is caught, and a scenario without one claims nothing", async () => {
  // A check that passes on every input it will ever see is indistinguishable
  // from a check that does not run, and DH-PIN is the one most exposed to that:
  // its expectations were captured from a verified run, so of course they hold.
  // This feeds it an expectation that is false and an expectation that is
  // absent, and asserts it can tell the difference.
  const pin = CHECKS.find((check) => check.id === "DH-PIN");
  const scenarios = await loadScenarios();
  const scenario = scenarios.find((entry) => entry.id === "low-readiness-takes-a-step-off");
  const result = await runChain(scenario);

  const wrong = pin.run({
    ...result,
    scenario: { ...scenario, expectedDecision: { type: "keep", governingRule: "EVD-R-001" } }
  });
  assert.equal(wrong.length, 2, `a false pin must fail on each field it names: ${wrong.join("; ")}`);

  const unpinned = pin.run({ ...result, scenario: { ...scenario, expectedDecision: undefined } });
  assert.deepEqual(unpinned, [], "a scenario with no pin makes no claim and must not fail");

  // Partial pins are the normal case: only what is written down is asserted.
  const partial = pin.run({
    ...result,
    scenario: { ...scenario, expectedDecision: { type: result.decision.decision.type } }
  });
  assert.deepEqual(partial, []);
});

test("every active rule can be re-run, verified and traced from a scenario", async () => {
  // Stated separately from the invariants because it fails differently: an
  // uncovered rule is not a decision behaving badly, it is a decision this
  // harness has never seen. A rule added to the library needs a scenario here,
  // or the checks above will keep passing while saying nothing about it.
  const { coverage } = await runHarness();
  assert.deepEqual(
    coverage.uncovered,
    [],
    `no scenario fires ${coverage.uncovered.join(", ")} — add one to harness/scenarios, or the ` +
      `harness cannot speak for that rule`
  );
});

test("the harness runs the same chain the tool runs", async () => {
  // The reason this test exists. `harness/lib/chain.js` reproduces what
  // `decideSessionTool` does before the engine is called — the semantic state,
  // the impulse-response ratio, the canonicalization of movement names. A copy
  // is a thing that drifts, and a harness quietly checking a pipeline that
  // stopped resembling the shipped one is worse than no harness. So the two are
  // compared on a scenario chosen for having several of those steps matter at
  // once: a restriction matched by spoken name, and a recovery rule alongside
  // it.
  const scenarios = await loadScenarios();
  const scenario = scenarios.find((entry) => entry.id === "a-restriction-outranks-a-recovery-rule");
  assert.ok(scenario, "the scenario this test compares against has been renamed or removed");

  const direct = await runChain(scenario);

  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "evidra_decide_session",
        arguments: {
          evidence: scenario.evidence,
          date: scenario.date,
          scheduledSession: scenario.scheduledSession
        }
      }
    })
  );
  assert.ok(!response.error, `the tool refused the scenario: ${JSON.stringify(response.error)}`);
  const viaTool = JSON.parse(response.result.content[0].text);

  assert.deepEqual(viaTool.decision, direct.decision.decision);
  assert.deepEqual(viaTool.action, direct.decision.action);
  assert.deepEqual(
    viaTool.decisionBasis?.governingRule?.ruleId,
    direct.decision.decisionBasis?.governingRule?.ruleId
  );
  assert.deepEqual(viaTool.reason, direct.decision.reason);
});

test("every threshold that decides something has a straddle at its edge", async () => {
  // The set-level half of DH-BND, stated separately for the reason DH-COV is:
  // a threshold nothing approaches is not a decision behaving badly, it is a
  // number that could move without a single check going red.
  const { boundaries } = await runHarness();
  const unstraddled = boundaries.matrix.filter((row) => row.missing.length > 0);
  assert.deepEqual(
    unstraddled.map((row) => `${row.where} (${row.missing.join(", ")})`),
    [],
    "add a scenario to harness/scenarios, or the threshold is only ever seen from far away"
  );

  // An exemption has to cost a written reason. A silent one is how a threshold
  // stops being checked and nobody finds out.
  for (const row of boundaries.matrix) {
    if (row.required.length < 2) {
      assert.ok(
        row.unreachable && row.unreachable.length > 20,
        `${row.where} is exempt from having an edge and says nothing about why`
      );
    }
  }
});

test("a declaration that misstates where it sits is caught", async () => {
  // DH-BND's declarations were written against a verified run, so of course
  // they hold — which makes it indistinguishable from a check that does not
  // run. These are the three ways a straddle can lie, fed in deliberately.
  const { checkBoundaries } = await import("../lib/boundaries.js");
  const scenarios = await loadScenarios();
  const base = scenarios.find((entry) => entry.id === "target-fatigue-exactly-at-the-moderate-line");
  assert.ok(base, "the scenario this test rewrites has been renamed or removed");

  const ownFindings = async (rulePosition) => {
    const scenario = { ...base, rulePosition };
    const result = await runChain(scenario);
    const { findings } = await checkBoundaries([{ scenario, result }]);
    return findings.filter((finding) => finding.scenario === scenario.id);
  };

  // Truthful: fatigue is 45 and the threshold is 45.
  assert.deepEqual(
    await ownFindings([{ rule: "EVD-R-005", threshold: "muscleFatigueModerate", position: "boundary" }]),
    []
  );

  // A boundary that is not on the boundary. 45 is the value EVD-R-004 is not.
  const wrongThreshold = await ownFindings([
    { rule: "EVD-R-004", threshold: "muscleFatigueHigh", position: "boundary" }
  ]);
  assert.ok(
    wrongThreshold.some((finding) => /boundary/.test(finding.failure)),
    `a reading nowhere near the threshold passed as a boundary case: ${JSON.stringify(wrongThreshold)}`
  );

  // A silence claimed for a threshold that is not causing it: EVD-R-003 is
  // quiet here, but at 45 it is quiet by a mile, not by one step.
  const notJustBelow = await ownFindings([
    { rule: "EVD-R-003", threshold: "muscleFatigueMaxed", position: "just_below" }
  ]);
  assert.ok(
    notJustBelow.some((finding) => /more than one step/.test(finding.failure)),
    `44 points short of a threshold passed as "just below": ${JSON.stringify(notJustBelow)}`
  );

  // A straddle declared against a cap the rule applies after firing. There is
  // no side to be on, and accepting it would report coverage of a number
  // nothing is ever compared against.
  const notAComparison = await ownFindings([
    { rule: "EVD-R-001", threshold: "recoveryCapMinutes", position: "triggers" }
  ]);
  assert.ok(
    notAComparison.some((finding) => /no side to be on/.test(finding.failure)),
    `a cap was accepted as a threshold to straddle: ${JSON.stringify(notAComparison)}`
  );
});

test("every check is asked of every scenario", async () => {
  // A check that quietly stops running looks exactly like a check that passes.
  const { scenarios } = await runHarness();
  assert.ok(CHECKS.length > 0);
  for (const check of CHECKS) {
    assert.ok(check.id && check.question, "a check must state what it is asking");
    assert.equal(typeof check.run, "function");
  }
  assert.ok(scenarios.length > 0, "no scenario ran, so no check ran either");
});
