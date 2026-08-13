// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Evidence Flow Story 6. docs/pacevera-home.html's "Today's Brief" demo used
// to hand-author its keep/adjust/defer numbers and rule ids directly in a
// <script> block. This script instead runs the real chain — the same
// generateSemanticFitnessState + decideSession the Decision Harness uses —
// against three already-reviewed harness scenarios, and writes what it
// actually returns to docs/pacevera-home-scenarios.js. The three scenarios
// are synthetic (harness/scenarios/*.json, not anyone's real data — see
// CLAUDE.md §4 on not using one user's data as a design basis), but the
// numbers, rule id, and reason text on the page are now real engine output
// for that synthetic evidence, not invented UI copy.
//
//   npm run generate:home-scenarios
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadScenarios, runChain } from "../harness/lib/chain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, "../docs/pacevera-home-scenarios.js");

const CASES = [
  {
    key: "keep",
    scenarioId: "a-rested-day-runs-as-planned",
    statusClass: "",
    status: "Ready to train",
    attachment: "harness/scenarios/01-a-rested-day-runs-as-planned.json",
    prompt: "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    handoff: "Pacevera checked the evidence and confirmed the scheduled session."
  },
  {
    key: "adjust",
    scenarioId: "low-readiness-takes-a-step-off",
    statusClass: "adjust",
    status: "Adjust today",
    attachment: "harness/scenarios/02-low-readiness-takes-a-step-off.json",
    prompt: "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    handoff: "Pacevera checked the evidence and returned an accountable decision."
  },
  {
    key: "defer",
    scenarioId: "readiness-floor-defers-to-recovery",
    statusClass: "defer",
    status: "Recovery first",
    attachment: "harness/scenarios/03-readiness-floor-defers-to-recovery.json",
    prompt: "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    handoff: "Pacevera found recovery below the safety floor and replaced the session."
  }
];

function sleepLabel(hours) {
  if (hours === undefined || hours === null) return "— missing";
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return `${wholeHours}h ${String(minutes).padStart(2, "0")}m`;
}

function weeklyTrainingHours(evidence, date) {
  const asOf = new Date(`${date}T23:59:59Z`).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const minutes = (evidence.workouts || [])
    .filter((w) => {
      const started = new Date(w.startedAt).getTime();
      return started <= asOf && asOf - started <= sevenDaysMs;
    })
    .reduce((sum, w) => sum + (w.durationMinutes || 0), 0);
  return minutes / 60;
}

function sessionLabel(session) {
  const intensity = session.intensity ? session.intensity[0].toUpperCase() + session.intensity.slice(1) : "";
  return [session.focus, `${session.durationMinutes} min${intensity ? ` · ${intensity}` : ""}`];
}

async function main() {
  const scenarios = await loadScenarios();
  const built = {};

  for (const spec of CASES) {
    const scenario = scenarios.find((s) => s.id === spec.scenarioId);
    if (!scenario) throw new Error(`Harness scenario not found: ${spec.scenarioId}`);

    const { state, decision } = await runChain(scenario);
    const sleepHours = scenario.evidence.healthMetrics.find((m) => m.type === "sleep_duration_hours")?.value;
    const trainingHours = weeklyTrainingHours(scenario.evidence, scenario.date);
    const governingRule = decision.decisionBasis.governingRule;

    const reasonRuleTag = governingRule ? ` <code>RULE ${governingRule.ruleId}</code>` : "";
    const reasonText = decision.reason.join(" ");

    built[spec.key] = {
      status: spec.status,
      statusClass: spec.statusClass,
      metrics: [
        ["Readiness", String(state.readinessScore)],
        ["Sleep", sleepLabel(sleepHours)],
        ["Leg fatigue", `${decision.state.targetMuscleFatigue?.value ?? "—"} / 100`],
        ["Training load", `${trainingHours.toFixed(1)}h this week`]
      ],
      from: sessionLabel(decision.action.from),
      to: sessionLabel(decision.action.to ?? decision.action.from),
      evidence: `Readiness ${state.readinessScore} · recovery signals checked`,
      attachment: spec.attachment,
      prompt: spec.prompt,
      handoff: spec.handoff,
      reason: `<strong>Why this changed:</strong> ${reasonText}${reasonRuleTag}`
    };
  }

  const header = `// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.
//
// GENERATED FILE — do not hand-edit. Produced by
// scripts/generate-home-scenario-fixtures.js from harness/scenarios/
// (01, 02, 03) run through the real Decision Engine chain
// (generateSemanticFitnessState + decideSession). Regenerate with:
//   npm run generate:home-scenarios
`;
  const body = `const scenarios = ${JSON.stringify(built, null, 2)};\n`;
  await writeFile(outputPath, `${header}\n${body}`);
  console.log(`wrote ${outputPath}`);
  for (const [key, value] of Object.entries(built)) {
    console.log(`  ${key}: ${value.status} — ${value.from[0]} → ${value.to[0]}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
