/**
 * @typedef {"lose_fat" | "build_muscle" | "half_marathon" | "general_fitness" | "recovery"} GoalType
 * @typedef {"strength" | "run" | "ride" | "mobility" | "recovery" | "walk"} WorkoutType
 * @typedef {"apple_health" | "garmin" | "strava" | "oura" | "whoop" | "manual"} DataSource
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} id
 * @property {string} name
 * @property {string} timezone
 * @property {number} heightCm
 * @property {number} weightKg
 * @property {"beginner" | "intermediate" | "advanced"} fitnessLevel
 */

/**
 * @typedef {Object} Goal
 * @property {string} id
 * @property {GoalType} type
 * @property {string} label
 * @property {number} priority
 * @property {string=} targetDate
 */

/**
 * @typedef {Object} Preference
 * @property {string} category
 * @property {string} key
 * @property {string | number | boolean | string[]} value
 * @property {number} strength
 */

/**
 * @typedef {Object} InjuryConstraint
 * @property {string} id
 * @property {string} bodyRegion
 * @property {"low" | "moderate" | "high"} severity
 * @property {string[]} restrictions
 * @property {"active" | "resolved"} status
 */

/**
 * @typedef {Object} Equipment
 * @property {string} type
 * @property {string} location
 * @property {boolean} available
 */

/**
 * @typedef {Object} Workout
 * @property {string} id
 * @property {WorkoutType} type
 * @property {string} name
 * @property {string} startedAt
 * @property {number} durationMinutes
 * @property {number} rpe
 * @property {number} trainingLoad
 * @property {string[]} muscleGroups
 * @property {DataSource} source
 */

/**
 * @typedef {Object} HealthMetric
 * @property {"sleep_duration_hours" | "sleep_quality" | "hrv_ms" | "resting_hr_bpm" | "steps" | "stress"} type
 * @property {number} value
 * @property {string} unit
 * @property {string} recordedAt
 * @property {DataSource} source
 */

/**
 * @typedef {Object} UserFitnessContext
 * @property {UserProfile} user
 * @property {Goal[]} goals
 * @property {Preference[]} preferences
 * @property {InjuryConstraint[]} injuries
 * @property {Equipment[]} equipment
 * @property {Workout[]} workouts
 * @property {HealthMetric[]} healthMetrics
 */

export const REQUIRED_USER_FIELDS = ["id", "name", "timezone", "heightCm", "weightKg", "fitnessLevel"];

export function assertValidUserContext(context) {
  if (!context || typeof context !== "object") {
    throw new Error("User fitness context must be an object.");
  }

  for (const field of REQUIRED_USER_FIELDS) {
    if (context.user?.[field] === undefined || context.user?.[field] === null) {
      throw new Error(`Missing required user field: ${field}`);
    }
  }

  const collectionFields = ["goals", "preferences", "injuries", "equipment", "workouts", "healthMetrics"];
  for (const field of collectionFields) {
    if (!Array.isArray(context[field])) {
      throw new Error(`Expected ${field} to be an array.`);
    }
  }

  return true;
}
