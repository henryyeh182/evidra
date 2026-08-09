// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidPlan } from "./models.js";
import { previewPlanChange } from "./adaptPlan.js";
import { isDeepStrictEqual } from "node:util";

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

  if (!preview.changeRequest) {
    throw new Error("Preview is missing changeRequest.");
  }

  // The preview is caller-held by design, but its result is still a claim about
  // a specific plan and request. Recompute that claim before applying it so a
  // caller cannot keep the valid identity/version fields while replacing the
  // resulting plan or erasing the decision trace.
  const expected = previewPlanChange(plan, preview.changeRequest);
  for (const field of ["previewId", "baseVersion", "planId", "summary", "diff", "resultingPlan", "decisionBasis"]) {
    if (!isDeepStrictEqual(preview[field], expected[field])) {
      throw new Error(`Preview integrity check failed for ${field}.`);
    }
  }

  const committed = structuredClone(preview.resultingPlan);
  committed.version = plan.version + 1;
  committed.status = "planned";
  assertValidPlan(committed);
  return committed;
}

/**
 * Describe how this plan reached its current version, as from -> to.
 *
 * A committed plan that only reports `version: 4` cannot be questioned: nothing
 * says what 3 was, what changed, or why. This is that record.
 *
 * Stateless, like everything else here: the server keeps no history, so the
 * entries carried by the caller-supplied plan are the earlier ones, and this
 * appends the commit being made now. A caller that keeps nothing still gets the
 * entry for this change; a caller that keeps the returned array gets the chain.
 *
 * No timestamp, deliberately. Nothing else in this package invents a value the
 * caller did not supply, and a clock reading would make the same inputs stop
 * producing the same output.
 */
export function buildVersionHistory(plan, preview, committed) {
  const previous = Array.isArray(plan.versionHistory) ? plan.versionHistory : [];

  return [
    ...previous,
    {
      version: committed.version,
      fromVersion: preview.baseVersion,
      previewId: preview.previewId,
      change: preview.changeRequest?.kind ?? null,
      summary: preview.summary ?? null
    }
  ];
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
