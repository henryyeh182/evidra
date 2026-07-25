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

function dailySumEvents(records) {
  const events = [];
  for (const [hkType, map] of Object.entries(DAILY_SUM_METRICS)) {
    const perDay = new Map();
    for (const record of records) {
      if (record.type !== hkType) continue;
      const day = dayOf(appleDateToIso(record.startDate || record.endDate));
      perDay.set(day, (perDay.get(day) || 0) + Number(record.value || 0));
    }
    for (const [day, total] of perDay) {
      const recordedAt = `${day}T23:59:59`;
      events.push({
        kind: "health_metric",
        id: stableId("apple_health", map.type, day),
        source: "apple_health",
        sourceRecordId: `${hkType}:${day}`,
        type: map.type,
        value: Math.round(total),
        unit: map.unit,
        recordedAt,
        confidence: 0.9,
        metadata: { aggregation: "daily_sum" }
      });
    }
  }
  return events;
}

function sleepEvents(records) {
  // Sum "asleep" intervals per night, keyed by the wake (endDate) calendar day.
  const perNight = new Map();
  for (const record of records) {
    if (record.type !== SLEEP_TYPE) continue;
    if (!String(record.value || "").includes("Asleep")) continue; // skip InBed / Awake
    const startIso = appleDateToIso(record.startDate);
    const endIso = appleDateToIso(record.endDate);
    const night = dayOf(endIso);
    perNight.set(night, (perNight.get(night) || 0) + Math.max(0, durationHours(startIso, endIso)));
  }
  return [...perNight].map(([night, hours]) => ({
    kind: "health_metric",
    id: stableId("apple_health", "sleep_duration_hours", night),
    source: "apple_health",
    sourceRecordId: `${SLEEP_TYPE}:${night}`,
    type: "sleep_duration_hours",
    value: Number(hours.toFixed(2)),
    unit: "hours",
    recordedAt: `${night}T07:00:00`,
    confidence: 0.85,
    metadata: { aggregation: "per_night" }
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
  HKWorkoutActivityTypePreparationAndRecovery: "recovery"
};

const TYPE_INTENSITY = { run: 6, ride: 5, walk: 3, strength: 7, mobility: 3, recovery: 2 };

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

export function normalizeAppleHealthWorkout(workout) {
  const type = WORKOUT_TYPE_MAP[workout.workoutActivityType] || "recovery";
  const durationMinutes = Math.max(1, Math.round(Number(workout.duration || 0)));
  // Apple Health has no RPE. Prefer the workout's measured active energy as the
  // training load (real signal); fall back to a duration x per-type-intensity
  // estimate when energy is missing. Energy-based load can underweight strength
  // (mechanical load isn't captured by kcal) — flagged via loadSource.
  const kcal = workout.totalEnergyBurned ? Number(workout.totalEnergyBurned) : null;
  const rpe = Math.round(TYPE_INTENSITY[type] ?? 5);
  const durationLoad = Math.round(durationMinutes * (rpe / 10) * 2);
  const trainingLoad = kcal ? Math.round(kcal / 10) : durationLoad;
  const loadSource = kcal ? "active_energy" : "duration_estimate";
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
      totalDistanceKm: workout.totalDistance ? Number(workout.totalDistance) : null,
      totalEnergyKcal: kcal,
      sourceName: workout.sourceName ?? null,
      rpeEstimated: true,
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
