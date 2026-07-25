/**
 * Garmin Connect export → Fitness Evidence Model.
 *
 * Garmin ships its own composite scores, and where they are available they are
 * better evidence than anything we could re-derive from raw signals — they had
 * the device on the wrist. So vendor assessments come in as evidence rather
 * than being ignored and recomputed.
 *
 * What is actually usable differs sharply from what the export nominally
 * contains. Measured over one real 328-record export:
 *
 *   recoveryTime      99%   ← the dependable one
 *   bodyBattery       76%
 *   acuteLoad         70%
 *   readiness score    5%   ← Garmin cannot compute it without valid sleep
 *   hrvWeeklyAverage  100% but constant — stale, not a signal
 *
 * A user who does not wear the watch overnight loses Garmin's own readiness
 * score. Reading recoveryTime and bodyBattery instead is what keeps a decision
 * possible for them.
 */

const DAY = 86400000;

function toIsoDay(value) {
  if (value == null) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 1e11) return new Date(asNumber).toISOString();
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text;
}

/** Garmin's own recovery/energy assessments, kept labelled as theirs. */
export function normalizeGarminReadiness(records = []) {
  const events = [];
  for (const record of records) {
    const recordedAt = toIsoDay(record.calendarDate ?? record.timestamp);
    if (!recordedAt) continue;

    // Minutes until Garmin considers the athlete recovered. Present ~99% of the
    // time because it does not depend on a valid sleep record.
    if (typeof record.recoveryTime === "number" && record.recoveryTime > 0) {
      events.push({
        kind: "vendor_assessment",
        source: "garmin",
        type: "recovery_time_minutes",
        value: record.recoveryTime,
        unit: "minutes",
        recordedAt
      });
    }

    // Garmin's composite readiness. Only emitted when Garmin itself judged the
    // inputs sufficient — a score computed without sleep is not one we want to
    // launder into confidence.
    if (typeof record.score === "number" && record.level && record.level !== "NONE") {
      events.push({
        kind: "vendor_assessment",
        source: "garmin",
        type: "vendor_readiness",
        value: record.score,
        unit: "score_0_100",
        level: record.level,
        recordedAt
      });
    }

    if (typeof record.acuteLoad === "number" && record.acuteLoad > 0) {
      events.push({
        kind: "vendor_assessment",
        source: "garmin",
        type: "vendor_acute_load",
        value: record.acuteLoad,
        unit: "load",
        recordedAt
      });
    }
  }
  return events;
}

/** Body Battery: Garmin's energy-reserve model, 0–100. */
export function normalizeGarminDailySummary(records = []) {
  const events = [];
  for (const record of records) {
    const recordedAt = toIsoDay(record.calendarDate);
    if (!recordedAt) continue;

    if (typeof record.restingHeartRate === "number" && record.restingHeartRate > 0) {
      events.push({
        kind: "health_metric",
        type: "resting_hr_bpm",
        value: record.restingHeartRate,
        unit: "bpm",
        recordedAt,
        source: "garmin"
      });
    }

    if (typeof record.totalSteps === "number" && record.totalSteps > 0) {
      events.push({
        kind: "health_metric",
        type: "steps",
        value: record.totalSteps,
        unit: "count",
        recordedAt,
        source: "garmin"
      });
    }

    const stats = record.bodyBattery?.bodyBatteryStatList;
    if (Array.isArray(stats)) {
      // The overnight low is what says whether the day started recovered; the
      // daily high alone flatters a day that drained to nothing by evening.
      const lowest = stats.find((stat) => stat.bodyBatteryStatType === "LOWEST")?.statsValue;
      const highest = stats.find((stat) => stat.bodyBatteryStatType === "HIGHEST")?.statsValue;
      if (typeof highest === "number") {
        events.push({
          kind: "vendor_assessment",
          source: "garmin",
          type: "body_battery",
          value: highest,
          low: typeof lowest === "number" ? lowest : null,
          unit: "score_0_100",
          recordedAt
        });
      }
    }
  }
  return events;
}

const ACTIVITY_TYPE_MAP = {
  running: "run",
  trail_running: "run",
  treadmill_running: "run",
  cycling: "ride",
  road_biking: "ride",
  indoor_cycling: "ride",
  walking: "walk",
  hiking: "walk",
  strength_training: "strength",
  indoor_cardio: "ride",
  yoga: "mobility",
  open_water_swimming: "ride",
  lap_swimming: "ride"
};

function activityTypeKey(activity) {
  const raw = activity.activityType;
  if (!raw) return "other";
  return typeof raw === "string" ? raw : raw.typeKey || "other";
}

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

export function normalizeGarminActivities(activities = []) {
  return activities
    .filter((activity) => activity.beginTimestamp)
    .map((activity) => {
      const key = activityTypeKey(activity);
      const type = ACTIVITY_TYPE_MAP[key] || "other";
      const durationMinutes = Math.max(1, Math.round((activity.duration ?? 0) / 60000));
      // Garmin computes activityTrainingLoad from EPOC — a far better load
      // estimate than anything we could derive from duration alone.
      const trainingLoad = typeof activity.activityTrainingLoad === "number"
        ? Math.round(activity.activityTrainingLoad)
        : Math.round(durationMinutes * 1.0);

      return {
        kind: "workout",
        id: `garmin_${activity.activityId ?? activity.beginTimestamp}`,
        type,
        name: activity.name || `Garmin ${type}`,
        startedAt: new Date(activity.beginTimestamp).toISOString(),
        durationMinutes,
        rpe: null,
        trainingLoad,
        muscleGroups: inferMuscleGroups(type),
        source: "garmin",
        metadata: {
          garminActivityType: key,
          avgHr: activity.avgHr ?? null,
          maxHr: activity.maxHr ?? null,
          distanceMeters: activity.distance ?? null,
          aerobicTrainingEffect: activity.aerobicTrainingEffect ?? null,
          anaerobicTrainingEffect: activity.anaerobicTrainingEffect ?? null,
          loadSource: typeof activity.activityTrainingLoad === "number" ? "garmin_epoc" : "duration_estimate"
        }
      };
    });
}

/**
 * Assemble a Garmin export into Fitness Evidence Model shape.
 *
 * @param {{ readiness?: object[], dailySummaries?: object[], activities?: object[] }} parts
 * @param {{ sinceDays?: number, asOf?: string }} [options]
 */
export function buildGarminEvidence(parts = {}, options = {}) {
  const readiness = normalizeGarminReadiness(parts.readiness);
  const daily = normalizeGarminDailySummary(parts.dailySummaries);
  const workouts = normalizeGarminActivities(parts.activities);

  const all = [...readiness, ...daily];
  const asOf = options.asOf ? new Date(options.asOf).getTime() : Date.now();
  const cutoff = options.sinceDays ? asOf - options.sinceDays * DAY : null;
  const inWindow = (iso) => !cutoff || new Date(iso).getTime() >= cutoff;

  return {
    healthMetrics: all.filter((event) => event.kind === "health_metric" && inWindow(event.recordedAt)),
    vendorAssessments: all.filter((event) => event.kind === "vendor_assessment" && inWindow(event.recordedAt)),
    workouts: workouts.filter((workout) => inWindow(workout.startedAt))
  };
}
