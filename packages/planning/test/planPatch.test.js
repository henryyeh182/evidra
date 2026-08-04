import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan } from "../src/generatePlan.js";
import { previewPlanChange } from "../src/adaptPlan.js";
import { applyPlanPreview, buildVersionHistory, summarizePlan } from "../src/planPatch.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

function seededPlan() {
  return generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
}

test("plan helpers are stateless", () => {
  const plan = seededPlan();
  assert.equal(summarizePlan(plan).version, 1);
  assert.equal(summarizePlan(plan).weekCount, 4);
});

test("applyPlanPreview bumps version without retaining state", () => {
  const plan = seededPlan();
  const preview = previewPlanChange(plan, { kind: "reduce_availability", weekdayAvailableMinutes: 25 });
  const committed = applyPlanPreview(plan, preview);
  assert.equal(committed.version, 2);
  assert.equal(committed.status, "planned");
  assert.equal(plan.version, 1);
  assert.equal(committed.constraints.weekdayAvailableMinutes, 25);
});

test("applyPlanPreview rejects a stale caller-held plan", () => {
  const plan = seededPlan();
  const preview = previewPlanChange(plan, { kind: "deload_week", weekIndex: 1 });
  const newerPlan = { ...plan, version: 2 };
  assert.throws(() => applyPlanPreview(newerPlan, preview), /stale/);
});

test("preview ids are deterministic across retries", () => {
  const plan = seededPlan();
  const request = { kind: "deload_week", weekIndex: 1 };
  assert.equal(previewPlanChange(plan, request).previewId, previewPlanChange(plan, request).previewId);
});

test("a committed version says what it came from and what changed", () => {
  const plan = seededPlan();
  const preview = previewPlanChange(plan, { kind: "deload_week", weekIndex: 1 });
  const committed = applyPlanPreview(plan, preview);

  const history = buildVersionHistory(plan, preview, committed);

  assert.equal(history.length, 1);
  assert.deepEqual(history[0], {
    version: 2,
    fromVersion: 1,
    previewId: preview.previewId,
    change: "deload_week",
    summary: preview.summary
  });
});

test("history the caller carried is extended, not replaced", () => {
  const plan = seededPlan();
  const earlier = { version: 1, fromVersion: 0, previewId: "preview_seed", change: null, summary: "created" };
  const carried = { ...plan, versionHistory: [earlier] };
  const preview = previewPlanChange(carried, { kind: "reduce_availability", weekdayAvailableMinutes: 25 });
  const committed = applyPlanPreview(carried, preview);

  const history = buildVersionHistory(carried, preview, committed);

  assert.equal(history.length, 2);
  assert.deepEqual(history[0], earlier);
  assert.equal(history[1].version, 2);
  assert.equal(history[1].fromVersion, 1);
});

test("a caller that kept no history still learns what this commit did", () => {
  const plan = seededPlan();
  const preview = previewPlanChange(plan, { kind: "deload_week", weekIndex: 1 });
  const committed = applyPlanPreview(plan, preview);

  assert.equal(buildVersionHistory(plan, preview, committed).length, 1);
});

test("the same commit produces the same history, because nothing reads a clock", () => {
  const plan = seededPlan();
  const request = { kind: "deload_week", weekIndex: 1 };

  const first = buildVersionHistory(plan, previewPlanChange(plan, request), applyPlanPreview(plan, previewPlanChange(plan, request)));
  const second = buildVersionHistory(plan, previewPlanChange(plan, request), applyPlanPreview(plan, previewPlanChange(plan, request)));

  assert.deepEqual(first, second);
});
