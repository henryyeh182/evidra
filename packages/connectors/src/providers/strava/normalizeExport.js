// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { stableId } from "../../../../db/src/id.js";
import { STRAVA_TYPE_MAP } from "./normalizeActivity.js";

/**
 * Turn a parsed Strava bulk export into normalized workout events.
 *
 * The export is a different dialect of Strava, not a different source, so
 * events land under `source: "strava"` and are keyed on `Activity ID` — the
 * same activity arriving twice (re-download, or export after API sync)
 * overwrites rather than doubles the athlete's load.
 *
 * Which training day a session belongs to depends on where the athlete was,
 * and the CSV never says. When the FIT files were read, `startedAt` carries
 * the recovered offset ("2026-07-26T09:45:16+08:00") and the calendar day is
 * simply true. When they were not, it stays a `Z` instant and
 * `timezoneKnown: false` travels with it, so nobody downstream mistakes a UTC
 * day for a training day.
 */

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

/**
 * RPE, best evidence first: what the athlete said, then heart rate against the
 * athlete's own maximum, then the session's own peak. When neither exists the
 * answer is null — an activity's type says what it was, not how hard it felt,
 * and a per-type constant would read downstream like the athlete reported it.
 * `rpeBasis` travels with the number so a decision can say which rung it stood
 * on — an RPE inferred against an unedited 220-age maximum is weaker evidence
 * than one the athlete typed in.
 */
function estimateRpe(activity, anchors) {
  if (activity.perceivedExertion !== null && activity.perceivedExertion !== undefined) {
    return { rpe: Math.max(1, Math.min(10, activity.perceivedExertion)), rpeBasis: "reported" };
  }

  const referenceMax = anchors?.maxHeartRateBpm ?? activity.maxHeartRate;
  if (activity.averageHeartRate && referenceMax) {
    const ratio = activity.averageHeartRate / referenceMax;
    const basis = anchors?.maxHeartRateBpm
      ? anchors.maxHeartRateIsAgeEstimate
        ? "athlete_max_hr_age_estimate"
        : "athlete_max_hr"
      : "session_max_hr";
    if (ratio >= 0.88) return { rpe: 8, rpeBasis: basis };
    if (ratio >= 0.8) return { rpe: 7, rpeBasis: basis };
    if (ratio >= 0.72) return { rpe: 6, rpeBasis: basis };
    if (ratio >= 0.62) return { rpe: 5, rpeBasis: basis };
    return { rpe: 4, rpeBasis: basis };
  }

  return { rpe: null, rpeBasis: "unavailable" };
}

/**
 * Training load.
 *
 * `Relative Effort` is chosen over the export's `Training Load` column even
 * though the latter looks more precise. Two reasons, both about comparability:
 * Relative Effort is present on every activity while Training Load only exists
 * when the session recorded weighted average power, and Relative Effort is the
 * same quantity the API calls `suffer_score`, so the two Strava dialects
 * produce numbers on one scale. The FTP-relative TSS is kept in metadata,
 * where it is useful without being silently mixed into a series.
 */
function resolveLoad(activity, rpe) {
  if (activity.relativeEffort !== null && activity.relativeEffort !== undefined) {
    return { trainingLoad: Math.round(activity.relativeEffort), loadSource: "relative_effort" };
  }

  // The duration estimate is only as real as the RPE it scales; with no RPE
  // there is nothing to scale, and duration alone is not a load.
  if (typeof rpe !== "number") {
    return { trainingLoad: null, loadSource: "unavailable" };
  }

  const minutes = Math.max(1, Math.round((activity.movingSeconds ?? activity.elapsedSeconds ?? 60) / 60));
  return { trainingLoad: Math.round(minutes * (rpe / 10) * 2), loadSource: "duration_estimate" };
}

/**
 * @param {import("./parseExport.js").StravaExportActivity} activity
 * @param {{ anchors?: object|null, sets?: object[] }} [context]
 * @returns {import("../../models.js").NormalizedWorkoutEvent}
 */
export function normalizeStravaExportActivity(activity, context = {}) {
  const { anchors = null, sets = [] } = context;

  const type = STRAVA_TYPE_MAP[activity.activityType] || "recovery";
  const durationMinutes = Math.max(
    1,
    Math.round((activity.movingSeconds ?? activity.elapsedSeconds ?? 60) / 60)
  );
  const { rpe, rpeBasis } = estimateRpe(activity, anchors);
  const { trainingLoad, loadSource } = resolveLoad(activity, rpe);
  const sourceRecordId = String(activity.activityId);

  return {
    kind: "workout",
    id: stableId("strava", sourceRecordId),
    sourceRecordId,
    source: "strava",
    type,
    name: activity.name || `Strava ${type}`,
    // Offset form when the FIT file gave one up, because it makes the calendar
    // day correct without anyone having to know the athlete's timezone.
    startedAt: activity.startedAtLocal || activity.startedAtUtc,
    durationMinutes,
    rpe,
    trainingLoad,
    muscleGroups: inferMuscleGroups(type),
    metadata: {
      dialect: "strava_export",
      // The CSV never says where the athlete was. When this is false the
      // offset was not recovered, and anyone turning this into a calendar day
      // needs a timezone from somewhere else.
      timezoneKnown: activity.timezoneKnown === true,
      utcOffsetSeconds: activity.utcOffsetSeconds ?? null,
      startedAtUtc: activity.startedAtUtc,
      uploadId: activity.uploadId,
      distanceMeters: activity.distanceMeters,
      elevationGainMeters: activity.elevationGainMeters,
      averageHeartRate: activity.averageHeartRate,
      maxHeartRate: activity.maxHeartRate,
      averageSpeedMetersPerSecond: activity.averageSpeedMetersPerSecond,
      calories: activity.calories,
      // Present only when the session recorded power, and expressed as a
      // percentage of this athlete's FTP — comparable within the athlete, not
      // across athletes, and wrong if that FTP is stale.
      trainingLoadTss: activity.trainingLoad,
      intensityFactorPercent: activity.intensityFactor,
      weightedAveragePower: activity.weightedAveragePower,
      ftpWattsAtImport: anchors?.functionalThresholdPowerWatts ?? null,
      // Counts one activity, not one day — never fold into daily steps.
      activitySteps: activity.activitySteps,
      rpeBasis,
      // An absent RPE was not estimated — read `rpeBasis` to tell the two apart.
      rpeEstimated: rpe !== null && rpeBasis !== "reported",
      loadSource,
      sets
    }
  };
}

/**
 * @param {{ activities: object[], anchors?: object|null, structuredSets?: object[] }} parsed
 * @returns {Array<import("../../models.js").NormalizedWorkoutEvent>}
 */
export function normalizeStravaExport(parsed) {
  const setsByActivity = new Map();
  for (const set of parsed.structuredSets || []) {
    if (!set.activityId) continue;
    if (!setsByActivity.has(set.activityId)) setsByActivity.set(set.activityId, []);
    setsByActivity.get(set.activityId).push(set);
  }

  return (parsed.activities || []).map((activity) =>
    normalizeStravaExportActivity(activity, {
      anchors: parsed.anchors ?? null,
      sets: setsByActivity.get(String(activity.activityId)) ?? []
    })
  );
}

/**
 * What this export can and cannot answer, before any decision is attempted.
 *
 * Stated as capability first: a Strava-only athlete gets decisions from
 * training load, and the absence of recovery physiology belongs in
 * `missing`/confidence rather than in the narrative.
 *
 * @param {{ activities: object[], anchors?: object|null, structuredSets?: object[] }} parsed
 */
export function describeStravaExportCoverage(parsed) {
  const activities = parsed.activities || [];
  const withRelativeEffort = activities.filter((a) => a.relativeEffort !== null).length;
  const withPower = activities.filter((a) => a.trainingLoad !== null).length;
  const withHeartRate = activities.filter((a) => a.averageHeartRate !== null).length;
  const withOffset = activities.filter((a) => a.timezoneKnown === true).length;

  const missing = ["sleep", "hrv", "restingHeartRate"];
  if (withPower === 0) missing.push("sessionTrainingLoadTss");

  // Partial is its own answer, and it gets its own bucket rather than being
  // listed as both usable and missing: an export with some FIT files pruned
  // can place some sessions on a real training day and not others, and a
  // reader has to be able to tell that from "all" or "none".
  const partial = [];
  if (withOffset === 0) missing.push("localTimezone");
  else if (withOffset < activities.length) partial.push("localTimezone");

  return {
    source: "strava_export",
    activities: activities.length,
    usable: [
      ...(withRelativeEffort > 0 ? ["sessionRelativeEffort"] : []),
      ...(withPower > 0 ? ["sessionTrainingLoadTss", "sessionIntensityFactor"] : []),
      ...(withHeartRate > 0 ? ["sessionHeartRate"] : []),
      ...(withOffset === activities.length && activities.length > 0 ? ["localTimezone"] : []),
      ...((parsed.structuredSets || []).length > 0 ? ["exerciseSets"] : [])
    ],
    partial,
    missing,
    activitiesWithLocalOffset: withOffset,
    // A load series built on Relative Effort rests on the athlete's maximum
    // heart rate. Whether that maximum was measured or seeded from 220-age is
    // the difference between evidence and an assumption.
    maxHeartRateIsAgeEstimate: parsed.anchors?.maxHeartRateIsAgeEstimate ?? null,
    ftpWatts: parsed.anchors?.functionalThresholdPowerWatts ?? null
  };
}
