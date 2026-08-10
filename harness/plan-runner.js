// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Plan Decision Harness.
 *
 * `npm run harness:plan`
 *
 * This covers the plan decision surface the session harness cannot drive:
 * `evidra_generate_plan`, `evidra_preview_adjust_plan` and
 * `evidra_commit_adjust_plan`. It intentionally calls the MCP tools over
 * JSON-RPC so the harness watches the same stateless boundary a host uses.
 */

import { fileURLToPath } from "node:url";
import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";

let nextId = 9000;

async function callTool(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args }
    })
  );
  if (response.error) {
    throw new Error(`${name} failed at the protocol level: ${JSON.stringify(response.error)}`);
  }
  const payload = JSON.parse(response.result.content[0].text);
  return { payload, isError: Boolean(response.result.isError) };
}

async function expectTool(name, args) {
  const result = await callTool(name, args);
  if (result.isError) {
    throw new Error(`${name} refused: ${result.payload.problem ?? result.payload.error ?? "unknown"}`);
  }
  return result.payload;
}

async function expectRefusal(name, args, expectedError) {
  const result = await callTool(name, args);
  if (!result.isError) {
    return [`${name} accepted a request that should have been refused`];
  }
  if (expectedError && result.payload.error !== expectedError) {
    return [`${name} refused with ${result.payload.error}, expected ${expectedError}`];
  }
  return [];
}

const BASE_EVIDENCE = {
  profile: { timezone: "UTC", fitnessLevel: "intermediate" },
  goals: [{ type: "half_marathon", label: "Half marathon" }],
  workouts: [
    {
      type: "run",
      startedAt: "2026-08-05T07:00:00Z",
      durationMinutes: 45,
      trainingLoad: 120,
      muscleGroups: ["legs"]
    }
  ],
  constraints: {
    availableMinutes: 60,
    equipment: ["dumbbell", "barbell", "bench", "treadmill", "outdoor", "squat_rack", "pull_up_bar"]
  }
};

const SPARSE_EVIDENCE = {
  profile: { timezone: "UTC", fitnessLevel: "intermediate" },
  goals: [{ type: "half_marathon", label: "Half marathon" }],
  constraints: { availableMinutes: 45, equipment: ["outdoor"] }
};

function allSessions(plan) {
  return plan.weeks.flatMap((week) => week.sessions);
}

function exerciseIds(plan) {
  return allSessions(plan).flatMap((session) => session.exerciseIds || []);
}

function hasBasis(frame) {
  return (
    frame &&
    typeof frame.libraryVersion === "string" &&
    typeof frame.engineVersion === "string" &&
    frame.policies?.arbitration &&
    frame.policies?.combination &&
    Array.isArray(frame.appliedRules)
  );
}

function diffFields(preview) {
  return new Set((preview.diff || []).map((entry) => entry.field));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const SCENARIOS = [
  {
    id: "generate-plan-with-full-evidence",
    async run() {
      const args = { startDate: "2026-08-10", weeks: 2, evidence: BASE_EVIDENCE };
      const plan = await expectTool("evidra_generate_plan", args);
      const again = await expectTool("evidra_generate_plan", args);
      const failures = [];

      if (!sameJson(plan, again)) {
        failures.push("generate_plan produced different plans for the same evidence");
      }
      if (!hasBasis(plan.decisionBasis)) {
        failures.push("generate_plan did not carry a complete decisionBasis frame");
      }
      if (plan.version !== 1 || plan.status !== "planned") {
        failures.push(`generated plan should start as version 1/planned, got ${plan.version}/${plan.status}`);
      }
      if (plan.weeks.length !== 2) {
        failures.push(`generated plan should have 2 weeks, got ${plan.weeks.length}`);
      }
      if (allSessions(plan).some((session) => !Array.isArray(session.exerciseIds) || session.exerciseIds.length === 0)) {
        failures.push("one or more generated sessions has no resolved exerciseIds");
      }

      return { failures, artifacts: { plan } };
    }
  },
  {
    id: "preview-plan-change-adds-injury",
    async run() {
      const plan = await expectTool("evidra_generate_plan", {
        startDate: "2026-08-10",
        weeks: 2,
        evidence: BASE_EVIDENCE
      });
      const request = {
        kind: "add_injury",
        bodyRegion: "knee",
        restrictions: ["no loaded knee flexion"],
        avoidMovements: ["squat"]
      };
      const preview = await expectTool("evidra_preview_adjust_plan", { plan, changeRequest: request });
      const again = await expectTool("evidra_preview_adjust_plan", { plan, changeRequest: request });
      const failures = [];

      if (!sameJson(preview, again)) {
        failures.push("preview_plan_change produced different previews for the same plan and request");
      }
      if (!hasBasis(preview.decisionBasis)) {
        failures.push("preview_plan_change did not carry a complete decisionBasis frame");
      }
      if (preview.decisionBasis.governingRule?.ruleId !== "EVD-R-011") {
        failures.push(`add_injury preview should be governed by EVD-R-011, got ${preview.decisionBasis.governingRule?.ruleId ?? "none"}`);
      }
      if (preview.patch?.decisionBasis?.governingRule?.ruleId !== "EVD-R-011") {
        failures.push("preview patch does not carry the same EVD-R-011 decision trace");
      }
      if (preview.baseVersion !== plan.version || preview.planId !== plan.id) {
        failures.push("preview boundary does not point back to the exact plan version it changed");
      }
      if (!diffFields(preview).has("exercises")) {
        failures.push("injury preview did not remove any movement from the plan");
      }
      for (const removed of preview.decisionBasis.governingRule?.measured?.movementsRemoved || []) {
        if (exerciseIds(preview.patch.resultingPlan).includes(removed)) {
          failures.push(`EVD-R-011 reports removing ${removed}, but it remains in the resulting plan`);
        }
      }

      return { failures, artifacts: { plan, preview } };
    }
  },
  {
    id: "commit-plan-change-keeps-lineage",
    async run() {
      const plan = await expectTool("evidra_generate_plan", {
        startDate: "2026-08-10",
        weeks: 2,
        evidence: BASE_EVIDENCE
      });
      const preview = await expectTool("evidra_preview_adjust_plan", {
        plan,
        changeRequest: {
          kind: "add_injury",
          bodyRegion: "knee",
          restrictions: ["no loaded knee flexion"],
          avoidMovements: ["squat"]
        }
      });
      const committed = await expectTool("evidra_commit_adjust_plan", { plan, preview: preview.patch });
      const again = await expectTool("evidra_commit_adjust_plan", { plan, preview: preview.patch });
      const failures = [];

      if (!sameJson(committed, again)) {
        failures.push("commit_plan_change produced different commits for the same plan and preview");
      }
      if (committed.version !== plan.version + 1 || committed.status !== "planned") {
        failures.push(`commit should return version ${plan.version + 1}/planned, got ${committed.version}/${committed.status}`);
      }
      if (!sameJson(committed.plan, { ...preview.patch.resultingPlan, version: plan.version + 1, status: "planned" })) {
        failures.push("committed plan is not the preview result with exactly version/status advanced");
      }
      if (!sameJson(committed.decisionBasis, preview.patch.decisionBasis)) {
        failures.push("commit recomputed, dropped, or changed the preview decisionBasis");
      }
      const history = committed.versionHistory || [];
      if (history.length !== 1 || history[0].fromVersion !== plan.version || history[0].previewId !== preview.previewId) {
        failures.push("commit did not preserve from-version and preview lineage in versionHistory");
      }

      failures.push(
        ...(await expectRefusal(
          "evidra_commit_adjust_plan",
          { plan: { ...plan, version: plan.version + 1 }, preview: preview.patch },
          "commit_refused"
        ))
      );
      failures.push(
        ...(await expectRefusal(
          "evidra_commit_adjust_plan",
          { plan, preview: { ...preview.patch, decisionBasis: null } },
          "commit_refused"
        ))
      );
      failures.push(
        ...(await expectRefusal(
          "evidra_commit_adjust_plan",
          {
            plan,
            preview: {
              ...preview.patch,
              resultingPlan: { ...preview.patch.resultingPlan, status: "archived" }
            }
          },
          "commit_refused"
        ))
      );

      return { failures, artifacts: { plan, preview, committed } };
    }
  },
  {
    id: "sparse-evidence-stays-honest",
    async run() {
      const plan = await expectTool("evidra_generate_plan", {
        startDate: "2026-08-10",
        weeks: 1,
        evidence: SPARSE_EVIDENCE
      });
      const failures = [];
      const text = [...(plan.reasoning || []), ...allSessions(plan).map((session) => session.rationale || "")].join(" ");

      if (!hasBasis(plan.decisionBasis)) {
        failures.push("sparse-evidence plan did not carry a decisionBasis frame");
      }
      for (const forbidden of [/readiness/i, /\bhrv\b/i, /recovered/i, /fresh/i, /training load is/i]) {
        if (forbidden.test(text)) {
          failures.push(`sparse evidence generated a precise readiness/training claim: ${forbidden}`);
        }
      }

      return { failures, artifacts: { plan } };
    }
  }
];

export async function runPlanHarness(scenarios = SCENARIOS) {
  const findings = [];
  const errors = [];
  const ran = [];

  for (const scenario of scenarios) {
    try {
      const result = await scenario.run();
      ran.push({ scenario, result });
      for (const failure of result.failures) {
        findings.push({ scenario: scenario.id, failure });
      }
    } catch (error) {
      errors.push({ scenario: scenario.id, message: error.message });
    }
  }

  return { scenarios: ran, findings, errors };
}

async function main() {
  const { scenarios, findings, errors } = await runPlanHarness();
  const title = "Plan Decision Harness";
  console.log(`\n${title}`);
  console.log("=".repeat(title.length));
  console.log(`Scenarios: ${scenarios.length}\n`);

  for (const { scenario } of scenarios) {
    const failed = findings.filter((finding) => finding.scenario === scenario.id);
    console.log(`  [${failed.length === 0 ? "PASS" : "FAIL"}] ${scenario.id}`);
    for (const finding of failed) console.log(`         ${finding.failure}`);
  }
  for (const error of errors) {
    console.log(`  [ERROR] ${error.scenario}`);
    console.log(`          ${error.message}`);
  }

  if (findings.length > 0 || errors.length > 0) {
    console.log(`\n${findings.length} finding(s), ${errors.length} error(s).\n`);
    process.exitCode = 1;
  } else {
    console.log(`\nPlan decision surface holds across ${scenarios.length} scenarios.\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
