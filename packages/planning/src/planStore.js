import { assertValidPlan } from "./models.js";

/**
 * Apply a caller-held preview to a caller-held plan.
 *
 * This module intentionally has no store, cache, counter, or repository. The
 * AI host/external storage owns plan versions and preview retention; the
 * server only validates the optimistic-concurrency boundary and computes the
 * next immutable value.
 */
export function applyPlanPreview(plan, preview) {
  assertValidPlan(plan);
  if (!preview || typeof preview !== "object") {
    throw new Error("A plan change preview is required.");
  }
  if (preview.planId !== plan.id) {
    throw new Error(`Preview belongs to plan ${preview.planId}, not ${plan.id}.`);
  }
  if (plan.version !== preview.baseVersion) {
    throw new Error(
      `Preview ${preview.previewId} is stale: it was built against version ${preview.baseVersion}, but the supplied plan is version ${plan.version}.`
    );
  }
  if (!preview.resultingPlan) {
    throw new Error("Preview is missing resultingPlan.");
  }

  const committed = structuredClone(preview.resultingPlan);
  committed.version = plan.version + 1;
  committed.status = "planned";
  assertValidPlan(committed);
  return committed;
}

export function summarizePlan(plan) {
  assertValidPlan(plan);
  return {
    id: plan.id,
    userId: plan.userId,
    goalId: plan.goalId,
    name: plan.name,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: plan.status,
    version: plan.version,
    weekCount: plan.weeks.length
  };
}
