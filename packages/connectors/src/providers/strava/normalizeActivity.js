import { stableId } from "../../../../db/src/id.js";

const STRAVA_TYPE_MAP = {
  Run: "run",
  TrailRun: "run",
  Ride: "ride",
  VirtualRide: "ride",
  Walk: "walk",
  Hike: "walk",
  Workout: "strength",
  WeightTraining: "strength",
  Yoga: "mobility"
};

function estimateRpe(activity) {
  if (activity.perceived_exertion) {
    return Math.max(1, Math.min(10, Number(activity.perceived_exertion)));
  }

  if (activity.average_heartrate && activity.max_heartrate) {
    const hrRatio = activity.average_heartrate / activity.max_heartrate;
    if (hrRatio >= 0.88) return 8;
    if (hrRatio >= 0.8) return 7;
    if (hrRatio >= 0.72) return 6;
    if (hrRatio >= 0.62) return 5;
  }

  if (activity.suffer_score) {
    if (activity.suffer_score >= 120) return 8;
    if (activity.suffer_score >= 80) return 7;
    if (activity.suffer_score >= 40) return 6;
  }

  return 5;
}

function estimateTrainingLoad(activity, rpe) {
  if (activity.suffer_score) {
    return Math.round(activity.suffer_score);
  }

  const durationMinutes = Math.max(1, Math.round(activity.moving_time / 60));
  const intensityFactor = rpe / 10;
  return Math.round(durationMinutes * intensityFactor * 2);
}

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") {
    return ["legs"];
  }

  if (type === "strength") {
    return ["full_body"];
  }

  if (type === "mobility") {
    return ["hips", "core"];
  }

  return [];
}

export function normalizeStravaActivity(activity) {
  const type = STRAVA_TYPE_MAP[activity.type] || "recovery";
  const durationMinutes = Math.max(1, Math.round((activity.moving_time || activity.elapsed_time || 60) / 60));
  const rpe = estimateRpe(activity);
  const trainingLoad = estimateTrainingLoad(activity, rpe);
  const sourceRecordId = String(activity.id);

  return {
    kind: "workout",
    id: stableId("strava", sourceRecordId),
    sourceRecordId,
    source: "strava",
    type,
    name: activity.name || `Strava ${type}`,
    startedAt: activity.start_date,
    durationMinutes,
    rpe,
    trainingLoad,
    muscleGroups: inferMuscleGroups(type),
    metadata: {
      distanceMeters: activity.distance ?? null,
      elevationGainMeters: activity.total_elevation_gain ?? null,
      averageHeartRate: activity.average_heartrate ?? null,
      maxHeartRate: activity.max_heartrate ?? null,
      averageSpeedMetersPerSecond: activity.average_speed ?? null,
      kudosCount: activity.kudos_count ?? null
    }
  };
}
