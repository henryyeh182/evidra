// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

export { assertRawProviderEvent, CONNECTOR_PROVIDERS } from "./models.js";
export { LocalConnectorAdapter, FixtureConnectorAdapter } from "./local.js";
export { computeTimeInZone, assertValidHeartRateZones } from "./timeInZone.js";
export {
  normalizedWorkoutToWorkout,
  normalizedHealthMetricToHealthMetric,
  applyNormalizedEventsToContext
} from "./normalization.js";
export {
  normalizeStravaActivity,
  parseStravaExport,
  attachLocalOffsets,
  readStravaFitOffset,
  readFitLocalOffset,
  readFitHeartRateSamples,
  readStravaActivityIntensity,
  formatUtcOffset,
  parseStravaActivitiesCsv,
  parseStravaPreferencesCsv,
  parseStravaStructuredDetailsCsv,
  stravaExportDateToIso,
  normalizeStravaExport,
  normalizeStravaExportActivity,
  describeStravaExportCoverage,
  STRAVA_EXPORT_SCHEMA
} from "./providers/strava/index.js";
export {
  parseAppleHealthExport,
  parseAppleHealthExportString,
  normalizeAppleHealthExport
} from "./providers/apple-health/index.js";
export {
  parseGoogleHealthExport,
  buildGoogleHealthEvidence,
  deriveExportOffsetMinutes,
  decodeMidnightOffsetMinutes
} from "./providers/google-health/index.js";
export {
  buildGarminEvidence,
  normalizeGarminReadiness,
  normalizeGarminDailySummary,
  normalizeGarminSleep,
  normalizeGarminHealthStatus,
  normalizeGarminActivities
} from "./providers/garmin/index.js";
export {
  buildOuraEvidence,
  normalizeOuraSleep,
  normalizeOuraDailySleep,
  normalizeOuraDailyReadiness,
  normalizeOuraDailyActivity,
  normalizeOuraWorkouts
} from "./providers/oura/index.js";
export {
  buildWhoopEvidence,
  normalizeWhoopRecovery,
  normalizeWhoopSleep,
  normalizeWhoopCycles,
  normalizeWhoopWorkouts
} from "./providers/whoop/index.js";
