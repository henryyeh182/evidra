import { stableId } from "../../../../db/src/id.js";

// --- date helpers ---------------------------------------------------------

// Apple Health writes dates as "2026-07-20 08:30:00 +0800". Normalize to ISO
// 8601 ("2026-07-20T08:30:00+08:00") so `new Date()` parses them reliably.
export function appleDateToIso(value) {
  if (!value) return value;
  const match = value.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
  if (!match) return value;
  return `${match[1]}T${match[2]}${match[3]}:${match[4]}`;
}

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

function durationHours(startIso, endIso) {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

// --- quantity metric mapping ---------------------------------------------

// Point-in-time quantity metrics: one normalized event per record.
const POINT_METRICS = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { type: "hrv_ms", unit: "ms" },
  HKQuantityTypeIdentifierRestingHeartRate: { type: "resting_hr_bpm", unit: "bpm" }
};

// Daily-summed quantity metrics.
const DAILY_SUM_METRICS = {
  HKQuantityTypeIdentifierStepCount: { type: "steps", unit: "count" }
};

const SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis";

function pointMetricEvent(record) {
  const map = POINT_METRICS[record.type];
  const recordedAt = appleDateToIso(record.startDate || record.endDate);
  return {
    kind: "health_metric",
    id: stableId("apple_health", map.type, recordedAt),
    source: "apple_health",
    sourceRecordId: `${record.type}:${recordedAt}`,
    type: map.type,
    value: Number(record.value),
    unit: map.unit,
    recordedAt,
    confidence: 0.9,
    metadata: { sourceName: record.sourceName ?? null }
  };
}

/**
 * A phone and a watch both count the same day's steps, and a synced Garmin
 * writes a third copy. Summing every record inflates those days; nothing in the
 * export ranks the recorders, so the day is the largest per-recorder sum —
 * never a double count, never below the best single recorder. Same rule the
 * Google Health connector applies to the same problem.
 */
function dailySumEvents(records) {
  const events = [];
  for (const [hkType, map] of Object.entries(DAILY_SUM_METRICS)) {
    const perDay = new Map(); // day → (sourceName → sum)
    for (const record of records) {
      if (record.type !== hkType) continue;
      const day = dayOf(appleDateToIso(record.startDate || record.endDate));
      const recorder = record.sourceName || "unknown";
      const bySource = perDay.get(day) || new Map();
      bySource.set(recorder, (bySource.get(recorder) || 0) + Number(record.value || 0));
      perDay.set(day, bySource);
    }
    for (const [day, bySource] of perDay) {
      const recordedAt = `${day}T23:59:59`;
      events.push({
        kind: "health_metric",
        id: stableId("apple_health", map.type, day),
        source: "apple_health",
        sourceRecordId: `${hkType}:${day}`,
        type: map.type,
        value: Math.round(Math.max(...bySource.values())),
        unit: map.unit,
        recordedAt,
        confidence: 0.9,
        metadata: {
          aggregation: "daily_max_across_sources",
          recorders: [...bySource.keys()].sort()
        }
      });
    }
  }
  return events;
}

/**
 * Sum "asleep" intervals per night, keyed by the wake (endDate) calendar day.
 *
 * Apple Health is a destination as much as a source: a night here may have been
 * measured by the watch, or synced in from another vendor's app hours later.
 * The stages are recorded per writer for the same reason steps are — a caller
 * that cannot tell which device produced a night cannot tell whether the
 * signal is still available tomorrow.
 */
function sleepEvents(records) {
  const perNight = new Map(); // night → { hours, recorders:Set }
  for (const record of records) {
    if (record.type !== SLEEP_TYPE) continue;
    if (!String(record.value || "").includes("Asleep")) continue; // skip InBed / Awake
    const startIso = appleDateToIso(record.startDate);
    const endIso = appleDateToIso(record.endDate);
    const night = dayOf(endIso);
    const entry = perNight.get(night) || { hours: 0, recorders: new Set() };
    entry.hours += Math.max(0, durationHours(startIso, endIso));
    entry.recorders.add(record.sourceName || "unknown");
    perNight.set(night, entry);
  }
  return [...perNight].map(([night, entry]) => ({
    kind: "health_metric",
    id: stableId("apple_health", "sleep_duration_hours", night),
    source: "apple_health",
    sourceRecordId: `${SLEEP_TYPE}:${night}`,
    type: "sleep_duration_hours",
    value: Number(entry.hours.toFixed(2)),
    unit: "hours",
    recordedAt: `${night}T07:00:00`,
    confidence: 0.85,
    metadata: { aggregation: "per_night", recorders: [...entry.recorders].sort() }
  }));
}

export function normalizeAppleHealthRecords(records) {
  const events = [];
  for (const record of records) {
    if (POINT_METRICS[record.type]) {
      events.push(pointMetricEvent(record));
    }
  }
  events.push(...dailySumEvents(records));
  events.push(...sleepEvents(records));
  return events;
}

// --- workout mapping ------------------------------------------------------

const WORKOUT_TYPE_MAP = {
  HKWorkoutActivityTypeRunning: "run",
  HKWorkoutActivityTypeWalking: "walk",
  HKWorkoutActivityTypeHiking: "walk",
  HKWorkoutActivityTypeCycling: "ride",
  HKWorkoutActivityTypeTraditionalStrengthTraining: "strength",
  HKWorkoutActivityTypeFunctionalStrengthTraining: "strength",
  HKWorkoutActivityTypeCoreTraining: "strength",
  HKWorkoutActivityTypeYoga: "mobility",
  HKWorkoutActivityTypeFlexibility: "mobility",
  HKWorkoutActivityTypePreparationAndRecovery: "recovery",
  HKWorkoutActivityTypeCooldown: "recovery"
};

const ACTIVE_ENERGY = "HKQuantityTypeIdentifierActiveEnergyBurned";
const DISTANCE_TYPES = [
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierDistanceCycling",
  "HKQuantityTypeIdentifierDistanceSwimming"
];

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Active energy, in kilocalories, from either dialect.
 *
 * Older exports put `totalEnergyBurned` on the <Workout> tag. Current ones put
 * it in a nested <WorkoutStatistics> instead, and reading only the tag reported
 * every session as loadless. Apple writes kilocalories as "Cal"; anything else
 * is left alone rather than converted on a guess.
 */
function activeEnergyKcal(workout) {
  const onTag = numberOrNull(workout.totalEnergyBurned);
  if (onTag !== null) return onTag;

  const stat = workout.statistics?.[ACTIVE_ENERGY];
  if (!stat) return null;
  const unit = (stat.unit || "").toLowerCase();
  if (unit && unit !== "cal" && unit !== "kcal") return null;
  return numberOrNull(stat.sum);
}

/** Distance in km, from either dialect. */
function distanceKm(workout) {
  const onTag = numberOrNull(workout.totalDistance);
  if (onTag !== null) return onTag;

  for (const type of DISTANCE_TYPES) {
    const stat = workout.statistics?.[type];
    if (!stat) continue;
    const unit = (stat.unit || "").toLowerCase();
    if (unit && unit !== "km") continue;
    const sum = numberOrNull(stat.sum);
    if (sum !== null) return sum;
  }
  return null;
}

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

export function normalizeAppleHealthWorkout(workout) {
  const type = WORKOUT_TYPE_MAP[workout.workoutActivityType] || "recovery";
  const durationMinutes = Math.max(1, Math.round(Number(workout.duration || 0)));
  // Apple Health has no RPE, so `rpe` stays null — an absent input is reported
  // absent rather than replaced by a per-type constant. Load uses the workout's
  // measured active energy when present (real signal); with no energy there is
  // nothing left to derive a load from, so that is null too. Energy-based load
  // can underweight strength (mechanical load isn't captured by kcal) — flagged
  // via loadSource.
  const kcal = activeEnergyKcal(workout);
  const rpe = null;
  const trainingLoad = kcal ? Math.round(kcal / 10) : null;
  const loadSource = kcal ? "active_energy" : "unavailable";
  const startedAt = appleDateToIso(workout.startDate);

  return {
    kind: "workout",
    id: stableId("apple_health", startedAt, workout.workoutActivityType || type),
    sourceRecordId: `${workout.workoutActivityType}:${startedAt}`,
    source: "apple_health",
    type,
    name: `Apple Health ${type}`,
    startedAt,
    durationMinutes,
    rpe,
    trainingLoad,
    muscleGroups: inferMuscleGroups(type),
    metadata: {
      totalDistanceKm: distanceKm(workout),
      totalEnergyKcal: kcal,
      sourceName: workout.sourceName ?? null,
      rpeEstimated: false,
      loadSource
    }
  };
}

/**
 * Normalize a parsed Apple Health export into the connector event stream that
 * `applyNormalizedEventsToContext` consumes.
 *
 * @param {{ records: object[], workouts: object[] }} parsed
 * @returns {Array<import("../../models.js").NormalizedWorkoutEvent | import("../../models.js").NormalizedHealthMetricEvent>}
 */
export function normalizeAppleHealthExport(parsed) {
  return [
    ...normalizeAppleHealthRecords(parsed.records || []),
    ...(parsed.workouts || []).map(normalizeAppleHealthWorkout)
  ];
}
