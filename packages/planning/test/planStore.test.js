import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateTrainingPlan } from "../src/generatePlan.js";
import { previewPlanChange } from "../src/adaptPlan.js";
import { createPlanStore } from "../src/planStore.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

function seededStore() {
  const store = createPlanStore();
  const plan = generateTrainingPlan(context, { startDate: "2026-07-27", weeks: 4 });
  store.savePlan(plan);
  return { store, plan };
}

test("planStore saves and lists plans", () => {
  const { store, plan } = seededStore();
  assert.equal(store.getPlan(plan.id).id, plan.id);

  const listed = store.listPlans("user_henry_demo");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].version, 1);
  assert.equal(listed[0].weekCount, 4);
});

test("commitPreview bumps version and records history", () => {
  const { store, plan } = seededStore();
  const preview = previewPlanChange(plan, { kind: "reduce_availability", weekdayAvailableMinutes: 25 });
  store.savePreview(preview);

  const committed = store.commitPreview(preview.previewId);
  assert.equal(committed.version, 2);
  assert.equal(committed.status, "planned");
  assert.equal(store.getPlan(plan.id).version, 2);

  const history = store.getVersionHistory(plan.id);
  assert.deepEqual(
    history.map((entry) => entry.version),
    [1, 2]
  );
  assert.equal(history[1].weekdayAvailableMinutes, 25);
});

test("commitPreview rejects a stale preview", () => {
  const { store, plan } = seededStore();
  const first = previewPlanChange(store.getPlan(plan.id), { kind: "deload_week", weekIndex: 1 });
  const second = previewPlanChange(store.getPlan(plan.id), { kind: "deload_week", weekIndex: 2 });
  store.savePreview(first);
  store.savePreview(second);

  store.commitPreview(first.previewId); // plan is now version 2
  assert.throws(() => store.commitPreview(second.previewId), /stale/);
});

test("commitPreview rejects an unknown preview id", () => {
  const { store } = seededStore();
  assert.throws(() => store.commitPreview("preview_missing"), /Unknown preview/);
});
