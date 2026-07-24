/**
 * @typedef {import("../../domain/src/models.js").UserFitnessContext} UserFitnessContext
 */

/**
 * @typedef {"base" | "build" | "peak" | "deload"} WeekPhase
 * @typedef {"planned" | "modified" | "archived"} PlanStatus
 */

/**
 * @typedef {Object} PlanConstraints
 * @property {number} weekdayAvailableMinutes
 * @property {number} longSessionMinutes
 * @property {string[]} availableEquipment
 * @property {string[]} restrictions
 * @property {string[]} avoidMovements
 */

/**
 * @typedef {Object} PlannedWorkout
 * @property {string} id
 * @property {string} dayOfWeek
 * @property {string} date
 * @property {string} focus
 * @property {import("../../domain/src/models.js").WorkoutType} type
 * @property {number} durationMinutes
 * @property {"low" | "moderate" | "high"} intensity
 * @property {string[]} targetMuscleGroups
 * @property {string[]} exercises
 * @property {string} rationale
 */

/**
 * @typedef {Object} PlannedWeek
 * @property {number} weekIndex
 * @property {WeekPhase} phase
 * @property {string} startDate
 * @property {number} loadMultiplier
 * @property {PlannedWorkout[]} sessions
 */

/**
 * @typedef {Object} TrainingPlan
 * @property {string} id
 * @property {string} userId
 * @property {string} goalId
 * @property {string} name
 * @property {string} startDate
 * @property {string} endDate
 * @property {string} periodizationType
 * @property {PlanStatus} status
 * @property {number} version
 * @property {PlanConstraints} constraints
 * @property {PlannedWeek[]} weeks
 * @property {string[]} reasoning
 * @property {string} createdAt
 */

/**
 * @typedef {(
 *   | { kind: "reduce_availability", weekdayAvailableMinutes: number, weekIndexes?: number[], reason?: string }
 *   | { kind: "add_injury", bodyRegion: string, restrictions?: string[], avoidMovements?: string[], reason?: string }
 *   | { kind: "deload_week", weekIndex: number, reason?: string }
 * )} PlanChangeRequest
 */

/**
 * @typedef {Object} PlanDiffEntry
 * @property {number} weekIndex
 * @property {string} date
 * @property {string} field
 * @property {*} before
 * @property {*} after
 * @property {string} reason
 */

/**
 * @typedef {Object} PlanChangePreview
 * @property {string} previewId
 * @property {string} planId
 * @property {number} baseVersion
 * @property {PlanChangeRequest} changeRequest
 * @property {PlanDiffEntry[]} diff
 * @property {TrainingPlan} resultingPlan
 * @property {string} summary
 */

const VALID_CHANGE_KINDS = ["reduce_availability", "add_injury", "deload_week"];

export function assertValidPlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new Error("Training plan must be an object.");
  }

  for (const field of ["id", "userId", "goalId", "startDate", "endDate"]) {
    if (plan[field] === undefined || plan[field] === null) {
      throw new Error(`Missing required plan field: ${field}`);
    }
  }

  if (!Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    throw new Error("Training plan must contain at least one week.");
  }

  return true;
}

export function assertValidChangeRequest(changeRequest) {
  if (!changeRequest || typeof changeRequest !== "object") {
    throw new Error("Change request must be an object.");
  }

  if (!VALID_CHANGE_KINDS.includes(changeRequest.kind)) {
    throw new Error(`Unknown change request kind: ${changeRequest.kind}`);
  }

  if (changeRequest.kind === "reduce_availability" && typeof changeRequest.weekdayAvailableMinutes !== "number") {
    throw new Error("reduce_availability requires numeric weekdayAvailableMinutes.");
  }

  if (changeRequest.kind === "add_injury" && typeof changeRequest.bodyRegion !== "string") {
    throw new Error("add_injury requires a bodyRegion string.");
  }

  if (changeRequest.kind === "deload_week" && typeof changeRequest.weekIndex !== "number") {
    throw new Error("deload_week requires a numeric weekIndex.");
  }

  return true;
}

export { VALID_CHANGE_KINDS };
