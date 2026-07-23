/**
 * @typedef {"apple_health" | "garmin" | "strava" | "oura" | "whoop" | "manual"} ConnectorProvider
 * @typedef {"activity" | "sleep" | "readiness" | "body" | "unknown"} RawEventType
 * @typedef {"workout" | "health_metric"} NormalizedEventType
 */

/**
 * @typedef {Object} RawProviderEvent
 * @property {string} id
 * @property {ConnectorProvider} provider
 * @property {RawEventType} type
 * @property {string} sourceRecordId
 * @property {string} observedAt
 * @property {unknown} payload
 */

/**
 * @typedef {Object} NormalizedWorkoutEvent
 * @property {"workout"} kind
 * @property {string} id
 * @property {string} sourceRecordId
 * @property {ConnectorProvider} source
 * @property {"strength" | "run" | "ride" | "mobility" | "recovery" | "walk"} type
 * @property {string} name
 * @property {string} startedAt
 * @property {number} durationMinutes
 * @property {number} rpe
 * @property {number} trainingLoad
 * @property {string[]} muscleGroups
 * @property {Object} metadata
 */

/**
 * @typedef {Object} NormalizedHealthMetricEvent
 * @property {"health_metric"} kind
 * @property {string} id
 * @property {ConnectorProvider} source
 * @property {string} sourceRecordId
 * @property {"sleep_duration_hours" | "sleep_quality" | "hrv_ms" | "resting_hr_bpm" | "steps" | "stress"} type
 * @property {number} value
 * @property {string} unit
 * @property {string} recordedAt
 * @property {number} confidence
 * @property {Object} metadata
 */

export const CONNECTOR_PROVIDERS = ["apple_health", "garmin", "strava", "oura", "whoop", "manual"];

export function assertRawProviderEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Raw provider event must be an object.");
  }

  for (const field of ["id", "provider", "type", "sourceRecordId", "observedAt", "payload"]) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`Missing raw provider event field: ${field}`);
    }
  }

  if (!CONNECTOR_PROVIDERS.includes(event.provider)) {
    throw new Error(`Unsupported connector provider: ${event.provider}`);
  }

  return true;
}
