import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan } from "../src/generatePlan.js";
import { previewPlanChange } from "../src/adaptPlan.js";
import { applyPlanPreview, summarizePlan } from "../src/planStore.js";

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
