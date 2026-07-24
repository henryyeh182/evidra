import { assertValidPlan } from "./models.js";

/**
 * In-memory, versioned plan store. Keeps the current plan plus its prior
 * versions so plan history survives edits. Deliberately dependency-free so it
 * can be swapped for a PostgreSQL-backed repository later without changing the
 * MCP tool surface.
 */
export function createPlanStore() {
  /** @type {Map<string, import("./models.js").TrainingPlan>} */
  const plans = new Map();
  /** @type {Map<string, import("./models.js").TrainingPlan[]>} */
  const history = new Map();
  /** @type {Map<string, import("./models.js").PlanChangePreview>} */
  const previews = new Map();

  function savePlan(plan) {
    assertValidPlan(plan);
    plans.set(plan.id, plan);
    if (!history.has(plan.id)) {
      history.set(plan.id, [structuredClone(plan)]);
    }
    return plan;
  }

  function getPlan(planId) {
    return plans.get(planId) || null;
  }

  function listPlans(userId) {
    return [...plans.values()]
      .filter((plan) => !userId || plan.userId === userId)
      .map((plan) => ({
        id: plan.id,
        userId: plan.userId,
        goalId: plan.goalId,
        name: plan.name,
        startDate: plan.startDate,
        endDate: plan.endDate,
        status: plan.status,
        version: plan.version,
        weekCount: plan.weeks.length
      }));
  }

  function savePreview(preview) {
    previews.set(preview.previewId, preview);
    return preview;
  }

  function getPreview(previewId) {
    return previews.get(previewId) || null;
  }

  function commitPreview(previewId) {
    const preview = previews.get(previewId);
    if (!preview) {
      throw new Error(`Unknown preview: ${previewId}`);
    }

    const current = plans.get(preview.planId);
    if (!current) {
      throw new Error(`Plan no longer exists: ${preview.planId}`);
    }
    if (current.version !== preview.baseVersion) {
      throw new Error(
        `Preview ${previewId} is stale: it was built against version ${preview.baseVersion}, but the plan is now version ${current.version}.`
      );
    }

    const committed = structuredClone(preview.resultingPlan);
    committed.version = current.version + 1;
    committed.status = "planned";

    plans.set(committed.id, committed);
    history.get(committed.id).push(structuredClone(committed));
    previews.delete(previewId);

    return committed;
  }

  function getVersionHistory(planId) {
    return (history.get(planId) || []).map((snapshot) => ({
      version: snapshot.version,
      status: snapshot.status,
      startDate: snapshot.startDate,
      weekdayAvailableMinutes: snapshot.constraints.weekdayAvailableMinutes
    }));
  }

  return {
    savePlan,
    getPlan,
    listPlans,
    savePreview,
    getPreview,
    commitPreview,
    getVersionHistory
  };
}
