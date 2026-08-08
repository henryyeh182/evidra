// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The Decision Harness.
 *
 * `npm run harness`
 *
 * What it is for. `eval/` asks whether a tool's output is shaped the way the
 * contract says; the per-package test suites ask whether a particular input
 * produces a particular answer. Neither asks whether a decision holds
 * together — whether
 * the reason can be traced to evidence, whether the rule the decision names is
 * the one the arbitration policy chose, whether a gap in the evidence was
 * reported or quietly filled. Those are properties of the decision chain rather
 * than of any one output, and this is where they are checked.
 *
 * Scope, stated because it is easy to assume otherwise: every check here runs
 * against `evidra_decide_session`'s chain and nothing else. `generatePlan` and
 * the exercise substitution path do not emit `decisionBasis` at all — the
 * server tells callers as much in its own instructions — so there is nothing
 * for these checks to read there. Extending the trace to those two surfaces is
 * a separate piece of work and this harness does not pretend to cover it.
 */

import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { loadScenarios, runChain } from "./lib/chain.js";
import { CHECKS } from "./lib/checks.js";
import { ruleCoverage } from "./lib/coverage.js";
import { computeFingerprint, compareFingerprint } from "./lib/fingerprint.js";

const FINGERPRINT_PATH = join(dirname(fileURLToPath(import.meta.url)), "rule-fingerprint.json");

/** The stored fingerprint of every rule field that can move a decision. */
export async function readFingerprint() {
  return JSON.parse(await readFile(FINGERPRINT_PATH, "utf8"));
}

export async function writeFingerprint() {
  const fingerprint = computeFingerprint();
  await writeFile(FINGERPRINT_PATH, `${JSON.stringify(fingerprint, null, 2)}\n`);
  return fingerprint;
}

/**
 * Which rules changed in a way that can move a decision, since the last time
 * anyone ran this and said so.
 */
export async function fingerprintDrift() {
  return compareFingerprint(await readFingerprint());
}

/**
 * Run every check against every scenario.
 *
 * @returns {Promise<{ scenarios: object[], findings: object[], errors: object[], coverage: object }>}
 */
export async function runHarness(scenarios) {
  const loaded = scenarios || (await loadScenarios());
  const findings = [];
  const errors = [];
  const ran = [];

  for (const scenario of loaded) {
    let result;
    try {
      result = await runChain(scenario);
    } catch (error) {
      errors.push({ scenario: scenario.id, message: error.message });
      continue;
    }
    ran.push({ scenario, result });

    for (const check of CHECKS) {
      let failures;
      try {
        failures = await check.run(result);
      } catch (error) {
        // A check that throws is a broken check, not a passing one. Reported
        // as a finding so it cannot be mistaken for silence.
        failures = [`the check itself failed to run: ${error.message}`];
      }
      for (const failure of failures) {
        findings.push({ check: check.id, scenario: scenario.id, failure });
      }
    }
  }

  // A rule nothing here reaches is a rule this harness cannot say anything
  // about, so it is reported as a finding rather than left to be noticed.
  const coverage = ruleCoverage(ran);
  for (const ruleId of coverage.uncovered) {
    findings.push({
      check: "DH-COV",
      scenario: "—",
      failure:
        `${ruleId} is active in the rule library and no scenario fires it, so nothing here can ` +
        `re-run, verify or trace a decision it governs`
    });
  }

  return { scenarios: ran, findings, errors, coverage };
}

async function main() {
  if (process.argv.includes("--update-fingerprint")) {
    // Deliberately not automatic, and deliberately not part of a passing run.
    // The whole value of the fingerprint is that moving it is a decision
    // somebody made after looking at what the rule edit did.
    const fingerprint = await writeFingerprint();
    console.log(
      `\nRule fingerprint updated for library ${fingerprint.libraryVersion}. ` +
        `Commit it with the rule edit.\n`
    );
    return;
  }

  const drift = await fingerprintDrift();

  return runHarness().then(({ scenarios, findings, errors, coverage }) => {
    const title = "Decision Harness";
    console.log(`\n${title}`);
    console.log("=".repeat(title.length));
    console.log(`Scenarios:  ${scenarios.length}`);
    console.log(`Checks:     ${CHECKS.length} per scenario, 2 across the set\n`);

    for (const check of CHECKS) {
      const failed = findings.filter((finding) => finding.check === check.id);
      const mark = failed.length === 0 ? "PASS" : "FAIL";
      console.log(`  [${mark}] ${check.id}  ${check.question}`);
      for (const finding of failed) {
        console.log(`         ${finding.scenario}: ${finding.failure}`);
      }
    }

    const coverageFailures = findings.filter((finding) => finding.check === "DH-COV");
    console.log(
      `\n  [${coverageFailures.length === 0 ? "PASS" : "FAIL"}] DH-COV  ` +
        `Is every active rule in the library reachable from a scenario?`
    );
    for (const ruleId of coverage.active) {
      const scenarioIds = coverage.covered.get(ruleId);
      console.log(
        `         ${ruleId}  ${scenarioIds ? scenarioIds.join(", ") : "NOT REACHED BY ANY SCENARIO"}`
      );
    }

    const moved = [...drift.changed, ...drift.added, ...drift.removed];
    console.log(
      `\n  [${moved.length === 0 && !drift.policiesMoved ? "PASS" : "FAIL"}] DH-FP   ` +
        `Has any rule's threshold, category or effect moved without being acknowledged?`
    );
    if (drift.policiesMoved) {
      console.log(`         the arbitration or combination policy changed`);
    }
    for (const ruleId of drift.changed) console.log(`         ${ruleId} changed`);
    for (const ruleId of drift.added) console.log(`         ${ruleId} is new`);
    for (const ruleId of drift.removed) console.log(`         ${ruleId} is gone`);
    if (moved.length > 0 || drift.policiesMoved) {
      console.log(
        `\n         The checks above already ran against the new rules — read the decisions\n` +
          `         below and decide whether they are what the edit intended. Then:\n` +
          `             node harness/runner.js --update-fingerprint`
      );
    }

    if (errors.length > 0) {
      console.log(`\nScenarios that could not be run:`);
      for (const error of errors) console.log(`  ${error.scenario}: ${error.message}`);
    }

    // Every decision that came out, for a reader who wants to see what was
    // actually judged rather than only what failed.
    console.log(`\nDecisions:`);
    for (const { scenario, result } of scenarios) {
      const basis = result.decision.decisionBasis;
      const governing = basis?.governingRule?.ruleId ?? "—";
      const fired = basis?.appliedRules?.map((rule) => rule.ruleId).join(",") || "—";
      console.log(
        `  ${scenario.id}\n` +
          `    ${result.decision.decision.type} (${result.decision.decision.intent})` +
          `  governing ${governing}  fired ${fired}  confidence ${result.decision.confidence}`
      );
    }

    const unacknowledged = moved.length > 0 || drift.policiesMoved;
    if (findings.length > 0 || errors.length > 0 || unacknowledged) {
      console.log(
        `\n${findings.length} finding(s), ${errors.length} error(s)` +
          (unacknowledged ? `, ${moved.length} unacknowledged rule change(s)` : ``) +
          `.\n`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `\nAll ${CHECKS.length} checks hold across ${scenarios.length} scenarios, ` +
          `every active rule is reachable, and no rule has moved unacknowledged.\n`
      );
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
