// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Oura API v2 source-schema simulation scenarios.
 *
 * These verify **schema comprehension** — that the Semantic Fitness Layer reads
 * Oura's dialect and lands it in the canonical vocabulary. They are not a
 * tuning set. Nothing here calibrates a threshold and no check asserts what a
 * simulated person's readiness ought to be; simulated physiology is worth
 * nothing as a target to fit.
 *
 * The axis of variation is the shape of the documents, not the story of an
 * athlete:
 *
 *   complete_documents   all four endpoints supplied
 *   naps_and_rejected    a sleep list that is mostly not nights
 *   scorecard_only       daily_sleep supplied without sleep — the endpoint
 *                        confusion that had three registry mappings wrong
 *   unloaded_workouts    workouts present, and Oura publishes no load for them
 *   sparse_wear          the ring is worn on some nights and not others
 *
 * The values are freight. What is asserted is that they arrive with the right
 * name, unit and source, and that what did not arrive is reported missing.
 */

const DAY_MS = 86400000;

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** A night as the sleep endpoint returns it. Ordinary numbers, deliberately. */
function night(day, { hours = 7.25, hrv = 48, lowestHr = 52 } = {}) {
  return {
    id: `sleep_${day}`,
    day,
    type: "long_sleep",
    bedtime_start: `${day}T23:10:00+08:00`,
    bedtime_end: `${day}T07:05:00+08:00`,
    total_sleep_duration: Math.round(hours * 3600),
    time_in_bed: Math.round(hours * 3600) + 2400,
    average_hrv: hrv,
    lowest_heart_rate: lowestHr,
    average_heart_rate: lowestHr + 6,
    efficiency: 91,
    low_battery_alert: false
  };
}

function workout(day, activity = "running", minutes = 45) {
  return {
    id: `w_${day}`,
    activity,
    day,
    start_datetime: `${day}T06:00:00+08:00`,
    end_datetime: `${day}T${String(6 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+08:00`,
    intensity: "moderate",
    calories: minutes * 9,
    distance: minutes * 180,
    label: null,
    source: "oura"
  };
}

const TRAINING_DAYS = new Set([1, 3, 5]);

/** Every endpoint, every day. */
function completeDocuments(asOf, days) {
  const parts = { sleep: [], dailySleep: [], dailyReadiness: [], dailyActivity: [], workouts: [] };
  for (let daysAgo = 0; daysAgo < days; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    parts.sleep.push(night(day));
    parts.dailySleep.push({ id: `ds_${day}`, day, timestamp: `${day}T12:00:00+08:00`, score: 82, contributors: { total_sleep: 90, efficiency: 94 } });
    parts.dailyReadiness.push({ id: `dr_${day}`, day, timestamp: `${day}T12:00:00+08:00`, score: 74, contributors: { hrv_balance: 61, resting_heart_rate: 88 } });
    parts.dailyActivity.push({ id: `da_${day}`, day, timestamp: `${day}T12:00:00+08:00`, steps: 9400, score: 88 });
    if (TRAINING_DAYS.has(daysAgo % 7)) parts.workouts.push(workout(day));
  }
  return parts;
}

/** A sleep list where only one entry is a night. */
function napsAndRejected(asOf, days) {
  const parts = completeDocuments(asOf, days);
  parts.sleep = parts.sleep.flatMap((record) => [
    { ...record, id: `${record.id}_nap`, type: "sleep", total_sleep_duration: 3600 },
    { ...record, id: `${record.id}_late`, type: "late_nap", total_sleep_duration: 2700 },
    { ...record, id: `${record.id}_rest`, type: "rest", total_sleep_duration: 5400 },
    { ...record, id: `${record.id}_del`, type: "deleted", total_sleep_duration: 25200 },
    record
  ]);
  return parts;
}

/** The scorecard without the measurements. */
function scorecardOnly(asOf, days) {
  const parts = completeDocuments(asOf, days);
  parts.sleep = [];
  return parts;
}

/** Workouts with no load, which is every Oura workout. */
function unloadedWorkouts(asOf, days) {
  const parts = completeDocuments(asOf, days);
  parts.workouts = parts.workouts.map((item) => ({ ...item, calories: null, distance: null }));
  return parts;
}

/** The ring is off the finger on most nights. */
function sparseWear(asOf, days) {
  const parts = completeDocuments(asOf, days);
  const worn = (day) => Number(day.slice(-1)) % 3 === 0;
  parts.sleep = parts.sleep.filter((record) => worn(record.day));
  parts.dailySleep = parts.dailySleep.filter((record) => worn(record.day));
  // Readiness needs a night behind it; without one Oura reports nothing.
  parts.dailyReadiness = parts.dailyReadiness.filter((record) => worn(record.day));
  return parts;
}

const PROFILE = { timezone: "Asia/Taipei", fitnessLevel: "intermediate" };
const GOALS = [{ type: "half_marathon", label: "Half marathon", priority: 1 }];
const CONSTRAINTS = { availableMinutes: 60 };

/** The prior state a decision acts on. Present so the pipeline runs end to end. */
const SCHEDULED_SESSION = {
  focus: "Tempo Run",
  type: "run",
  intensity: "high",
  durationMinutes: 60,
  muscleGroups: ["legs"]
};

export const OURA_SCENARIOS = [
  {
    id: "complete_documents",
    label: "All four endpoints, every day",
    purpose: "Every signal the registry declares for Oura must actually come out, with the right unit and source.",
    days: 28,
    build: completeDocuments,
    expectRecovery: ["sleep", "hrv", "restingHeartRate"],
    expectSignals: ["sleep_duration_hours", "sleep_quality", "hrv_ms", "resting_hr_bpm", "vendor_readiness", "steps"]
  },
  {
    id: "naps_and_rejected",
    label: "A sleep list that is four-fifths not a night",
    purpose:
      "Only long_sleep is a night. Counting naps, late naps, user-rejected 'rest' or deleted periods would report more sleep than the athlete had.",
    days: 28,
    build: napsAndRejected,
    expectRecovery: ["sleep", "hrv", "restingHeartRate"],
    expectSignals: ["sleep_duration_hours", "hrv_ms", "resting_hr_bpm"],
    // One night per day, not five.
    expectOneSleepReadingPerDay: true
  },
  {
    id: "scorecard_only",
    label: "daily_sleep supplied, sleep withheld",
    purpose:
      "daily_sleep carries a score and nothing else. Durations, HRV and heart rate must come back missing rather than being read off an endpoint that does not have them — the mistake three registry mappings made.",
    days: 28,
    build: scorecardOnly,
    expectRecovery: ["sleep"],
    expectSignals: ["sleep_quality", "vendor_readiness", "steps"],
    expectAbsent: ["hrv_ms", "resting_hr_bpm", "sleep_duration_hours"]
  },
  {
    id: "unloaded_workouts",
    label: "Workouts with no load, because Oura computes none",
    purpose:
      "Every session must reach the engine with trainingLoad null and be reported through signalCoverage.training.missing, not given a number derived from its duration.",
    days: 28,
    build: unloadedWorkouts,
    expectRecovery: ["sleep", "hrv", "restingHeartRate"],
    expectSignals: ["sleep_duration_hours", "hrv_ms"],
    expectTrainingMissing: true
  },
  {
    id: "sparse_wear",
    label: "The ring is worn on roughly one night in three",
    purpose: "Nights with no record produce no reading, and coverage shrinks honestly instead of being filled in.",
    days: 28,
    build: sparseWear,
    expectSignals: ["sleep_duration_hours", "hrv_ms", "steps"]
  }
];

export function buildOuraDocuments(scenario, { asOf }) {
  return scenario.build(asOf, scenario.days);
}

export { PROFILE, GOALS, CONSTRAINTS, SCHEDULED_SESSION };
