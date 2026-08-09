// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Every rule the decision harness cannot reach, exercised here.
 *
 * The harness scopes DH-COV and DH-BND to `appliedBy === "session"`, because a
 * rule the plan generator or the exercise catalog applies cannot fire on a
 * decide_session call no matter what a scenario contains. That scoping is only
 * honest if something else is obliged to exercise the rest, and this file is
 * that obligation: it drives the real tools over JSON-RPC and asserts each
 * remaining active rule both fires and comes back named in `decisionBasis`.
 *
 * The last test is the one that keeps this from rotting. It reads the library
 * rather than a list written here, so a fourth engine's rule added tomorrow
 * fails until somebody exercises it — the same shape of guard as DH-COV, moved
 * to the only place that can call every tool.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { handleJsonRpcMessage } from "../src/server.js";
import { getRuleLibrary, getRule } from "../../../packages/rules/src/index.js";

let nextId = 700;

async function call(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } })
  );
  assert.equal(response.error, undefined, `${name} failed at the protocol level`);
  const payload = JSON.parse(response.result.content[0].text);
  assert.ok(!response.result.isError, `${name} refused: ${payload.problem ?? payload.error ?? "unknown"}`);
  return payload;
}

/** Rules seen firing across this file, collected for the closing check. */
const fired = new Set();

/**
 * The two things a governing rule must be able to say about itself, checked on
 * every basis this file produces.
 *
 * Both were verified by hand on 2026-08-09 and passed, which is exactly why they
 * are here: a check that has been run once is a fact about that afternoon, and a
 * frame reporting a threshold the library does not hold would look no different
 * from one reporting the truth.
 *
 * The equivalent for decide_session is DH-7 in the harness, which also asserts
 * that a movement an injury rule named is gone from `action.to`. That is not
 * repeated here — the rules below remove nothing from a session.
 */
function assertGoverningRuleIsTruthful(basis, where) {
  const governing = basis.governingRule;
  if (!governing) return basis;

  // 1. The thresholds the caller is shown are the library's, verbatim. A frame
  //    that paraphrased them would be unfalsifiable against the rule it names.
  const declared = getRule(governing.ruleId).thresholds.map((t) => [t.key, t.operator, t.value, t.unit]);
  const reported = governing.thresholds.map((t) => [t.key, t.operator, t.value, t.unit]);
  assert.deepEqual(
    reported,
    declared,
    `${where}: ${governing.ruleId} reports thresholds that are not the ones session-rules.json declares`
  );

  // 2. An internal_composite rule cuts a quantity Evidra computes or matches
  //    itself, so no publication can support it. The loader enforces this on the
  //    library; this is the same claim checked on what actually leaves the server.
  if (governing.basis === "internal_composite") {
    assert.equal(
      governing.sources.length,
      0,
      `${where}: ${governing.ruleId} is internal_composite and shipped ${governing.sources.length} source(s), ` +
        `which would read as evidence for a threshold no study has used`
    );
  }
  return basis;
}

function record(basis, where = "basis") {
  for (const rule of basis?.appliedRules || []) fired.add(rule.ruleId);
  assertGoverningRuleIsTruthful(basis, where);
  return basis;
}

const EVIDENCE = {
  profile: { timezone: "UTC", fitnessLevel: "intermediate" },
  goals: [{ type: "half_marathon", label: "Half marathon" }],
  workouts: [
    { type: "run", startedAt: "2026-08-05T07:00:00Z", durationMinutes: 45, trainingLoad: 120, muscleGroups: ["legs"] }
  ],
  constraints: {
    availableMinutes: 60,
    equipment: ["dumbbell", "barbell", "bench", "treadmill", "outdoor", "squat_rack", "pull_up_bar"]
  }
};

test("EVD-R-010 fires when a high-impact restriction meets a high-intensity run", async () => {
  const plan = await call("evidra_generate_plan", {
    startDate: "2026-08-10",
    weeks: 1,
    evidence: {
      ...EVIDENCE,
      constraints: {
        ...EVIDENCE.constraints,
        injuries: [{ bodyRegion: "knee", status: "active", severity: "moderate", restrictions: ["avoid high-impact work"] }]
      }
    }
  });

  const basis = record(plan.decisionBasis, "generate_plan");
  assert.equal(basis.governingRule?.ruleId, "EVD-R-010");
  assert.equal(basis.governingRule.category, "injury");
  assert.ok(
    basis.governingRule.measured.sessionsHeldAtModerate > 0,
    "the rule is attributed to a plan where nothing was actually held back"
  );

  // The substance, not only the attribution: the tempo run must not still be high.
  const runs = plan.weeks[0].sessions.filter((session) => session.type === "run");
  assert.ok(runs.length > 0, "the template this test relies on no longer schedules a run");
  assert.ok(!runs.some((session) => session.intensity === "high"), "a run was left at high intensity");

  // And the count it reports is the count it caused. Measured as a difference
  // against the same plan generated without the injury, because "no run is at
  // high intensity" is also true of a template that never scheduled one — the
  // reading has to be attributable to this rule, not merely consistent with it.
  const withoutInjury = await call("evidra_generate_plan", {
    startDate: "2026-08-10",
    weeks: 1,
    evidence: EVIDENCE
  });
  const highRuns = (weeks) =>
    weeks[0].sessions.filter((session) => session.type === "run" && session.intensity === "high").length;
  assert.equal(
    basis.governingRule.measured.sessionsHeldAtModerate,
    highRuns(withoutInjury.weeks) - highRuns(plan.weeks),
    "EVD-R-010 reports holding back a number of runs that the plan does not show having been held back"
  );

  // And the part the rule is careful to disclaim, asserted so the disclaimer
  // stays true: this path removes no prescribed movement.
  assert.ok(
    basis.governingRule.limitations.some((limit) => limit.includes("removes nothing")),
    "EVD-R-010 must keep stating that it does not remove movements"
  );
});

test("a plan with no restriction still carries the frame, saying no rule applied", async () => {
  const plan = await call("evidra_generate_plan", { startDate: "2026-08-10", weeks: 1, evidence: EVIDENCE });

  assert.equal(plan.decisionBasis.governingRule, null);
  assert.deepEqual(plan.decisionBasis.appliedRules, []);
  assert.ok(plan.decisionBasis.libraryVersion, "the frame must identify the library even when empty");
});

test("EVD-R-011 fires when an injury is added to an existing plan", async () => {
  const plan = await call("evidra_generate_plan", { startDate: "2026-08-10", weeks: 1, evidence: EVIDENCE });

  const preview = await call("evidra_preview_adjust_plan", {
    plan,
    changeRequest: { kind: "add_injury", bodyRegion: "knee", restrictions: ["no loaded knee flexion"], avoidMovements: ["squat"] }
  });

  const basis = record(preview.decisionBasis, "preview_adjust_plan");
  assert.equal(basis.governingRule?.ruleId, "EVD-R-011");
  assert.ok(basis.governingRule.measured.injuryAffectedSessionsPresent >= 1);
  assert.ok(preview.diff.length > 0, "the rule is attributed to a preview that changed nothing");

  // Substance. A rule that names movements it removed and leaves them in the
  // plan is the failure this whole frame exists to make visible, so it is
  // checked against the plan the preview actually produces.
  const measured = basis.governingRule.measured;
  const remaining = preview.patch.resultingPlan.weeks
    .flatMap((week) => week.sessions)
    .flatMap((session) => session.exerciseIds || []);
  assert.ok(measured.movementsRemoved.length > 0, "this case is meant to remove at least one movement");
  for (const id of measured.movementsRemoved) {
    assert.ok(!remaining.includes(id), `EVD-R-011 reports removing ${id} and the resulting plan still prescribes it`);
  }

  // And the session count is the plan's own count, not a tally kept beside it.
  assert.equal(
    measured.injuryAffectedSessionsPresent,
    new Set(preview.diff.map((entry) => entry.date)).size,
    "EVD-R-011 reports a number of affected sessions that the diff does not show"
  );

  // The commit carries the same frame rather than deciding again.
  const committed = await call("evidra_commit_adjust_plan", { plan, preview: preview.patch });
  assert.equal(committed.decisionBasis?.governingRule?.ruleId, "EVD-R-011");
});

test("a change that is not an injury carries an empty frame, not an injury rule", async () => {
  const plan = await call("evidra_generate_plan", { startDate: "2026-08-10", weeks: 1, evidence: EVIDENCE });

  const preview = await call("evidra_preview_adjust_plan", {
    plan,
    changeRequest: { kind: "deload_week", weekIndex: 0 }
  });

  assert.equal(preview.decisionBasis.governingRule, null);
});

test("EVD-R-012 fires when the catalog drops a contraindicated candidate", async () => {
  const result = await call("evidra_decide_exercise_substitution", {
    exerciseId: "back squat",
    avoidContraindications: ["knee"],
    availableEquipment: ["bodyweight", "dumbbell", "barbell", "squat_rack"]
  });

  const basis = record(result.decisionBasis, "decide_exercise_substitution");
  assert.equal(basis.governingRule?.ruleId, "EVD-R-012");
  assert.ok(basis.governingRule.measured.excluded.length >= 1);

  // Substance. "Excluded" has to mean absent from everything the caller is
  // offered — the chosen movement and the alternatives alike. A candidate that
  // came back as an alternative would make the hard filter a ranking.
  const offered = [result.action.to?.exercise_id, ...result.alternatives.map((item) => item.exercise_id)];
  for (const item of basis.governingRule.measured.excluded) {
    assert.ok(
      !offered.includes(item.id),
      `EVD-R-012 reports excluding ${item.id} for ${item.matchedTags.join(", ")} and it is still offered`
    );
  }
  assert.ok(
    result.reason.some((line) => line.includes(basis.governingRule.measured.excluded[0].name)),
    "what the filter removed has to reach the athlete, not only the trace"
  );
});

test("a substitution with nothing to filter says so instead of claiming a filter ran", async () => {
  const result = await call("evidra_decide_exercise_substitution", {
    exerciseId: "back squat",
    avoidContraindications: ["knee"],
    availableEquipment: ["bodyweight", "dumbbell"]
  });

  // The equipment list already removed every contraindicated candidate, so the
  // injury filter had nothing to do. It used to print "were hard-filtered out"
  // regardless; the claim now has to match what happened.
  assert.equal(result.decisionBasis.governingRule, null);
  assert.ok(result.reason.some((line) => line.includes("removed nothing")));
});

test("every active rule the harness cannot reach is exercised in this file", () => {
  const unreachable = getRuleLibrary()
    .rules.filter((rule) => rule.status === "active" && rule.appliedBy !== "session")
    .map((rule) => rule.ruleId);

  const missing = unreachable.filter((ruleId) => !fired.has(ruleId));
  assert.deepEqual(
    missing,
    [],
    `${missing.join(", ")} is active, is outside the decision harness's reach, and nothing here ` +
      `fires it — so no check anywhere can speak for it. Add a case above, or the rule ships unexercised.`
  );
});
