// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * WHOOP API source-schema simulation scenarios.
 *
 * These verify **schema comprehension**, not physiology. Nothing here
 * calibrates a threshold and no check asserts what a simulated person's
 * readiness ought to be.
 *
 * The axis of variation is the shape of the documents:
 *
 *   complete_documents   recovery, sleep, cycles and workouts, all SCORED
 *   pending_scores       records that arrived before WHOOP scored them
 *   calibrating          WHOOP says its own recovery score is not yet accurate
 *   restless_nights      in-bed time and asleep time diverge sharply
 *   sparse_wear          the strap is worn on some days and not others
 *
 * `restless_nights` is the one that would have caught the bug this parser was
 * rewritten to fix: when a night is broken up, in-bed time and asleep time are
 * far apart, and the difference runs in the direction that flatters the
 * athlete.
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

function nextDay(day) {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);
}

/** A night. `awakeHours` is what separates in-bed time from asleep time. */
function sleep(day, { asleepHours = 7, awakeHours = 0.75, performance = 88 } = {}) {
  const light = asleepHours * 0.57;
  const sws = asleepHours * 0.215;
  const rem = asleepHours - light - sws;
  return {
    id: `sleep_${day}`,
    cycle_id: Number(day.replace(/-/g, "").slice(-6)),
    start: `${day}T23:05:00Z`,
    end: `${nextDay(day)}T06:50:00Z`,
    timezone_offset: "+08:00",
    nap: false,
    score_state: "SCORED",
    score: {
      stage_summary: {
        total_in_bed_time_milli: Math.round((asleepHours + awakeHours) * HOUR_MS),
        total_awake_time_milli: Math.round(awakeHours * HOUR_MS),
        total_no_data_time_milli: 0,
        total_light_sleep_time_milli: Math.round(light * HOUR_MS),
        total_slow_wave_sleep_time_milli: Math.round(sws * HOUR_MS),
        total_rem_sleep_time_milli: Math.round(rem * HOUR_MS),
        sleep_cycle_count: 5,
        disturbance_count: Math.round(awakeHours * 6)
      },
      sleep_performance_percentage: performance,
      sleep_efficiency_percentage: Number(((asleepHours / (asleepHours + awakeHours)) * 100).toFixed(1)),
      sleep_consistency_percentage: 74,
      respiratory_rate: 14.6
    }
  };
}

function recovery(day, { calibrating = false, score = 63 } = {}) {
  return {
    cycle_id: Number(day.replace(/-/g, "").slice(-6)),
    sleep_id: `sleep_${day}`,
    created_at: `${nextDay(day)}T07:00:00Z`,
    updated_at: `${nextDay(day)}T07:00:00Z`,
    score_state: "SCORED",
    score: {
      user_calibrating: calibrating,
      recovery_score: score,
      resting_heart_rate: 54,
      hrv_rmssd_milli: 41.813562
    }
  };
}

function cycle(day, strain = 12.4) {
  return {
    id: Number(day.replace(/-/g, "").slice(-6)),
    start: `${day}T00:00:00Z`,
    end: `${nextDay(day)}T00:00:00Z`,
    timezone_offset: "+08:00",
    score_state: "SCORED",
    score: { strain, kilojoule: 9400, average_heart_rate: 71, max_heart_rate: 168 }
  };
}

function workout(day, sport = "running", minutes = 45, strain = 9.41) {
  return {
    id: `w_${day}`,
    start: `${day}T06:00:00Z`,
    end: new Date(new Date(`${day}T06:00:00Z`).getTime() + minutes * 60000).toISOString(),
    timezone_offset: "+08:00",
    sport_name: sport,
    score_state: "SCORED",
    score: {
      strain,
      average_heart_rate: 148,
      max_heart_rate: 171,
      kilojoule: 2100,
      percent_recorded: 99,
      distance_meter: minutes * 180
    }
  };
}

const TRAINING_DAYS = new Set([1, 3, 5]);

function completeDocuments(asOf, days) {
  const parts = { recovery: [], sleep: [], cycles: [], workouts: [] };
  for (let daysAgo = 0; daysAgo < days; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    parts.sleep.push(sleep(day));
    parts.recovery.push(recovery(day));
    parts.cycles.push(cycle(day));
    if (TRAINING_DAYS.has(daysAgo % 7)) parts.workouts.push(workout(day));
  }
  return parts;
}

/** Records that arrived before WHOOP finished scoring them. */
function pendingScores(asOf, days) {
  const parts = completeDocuments(asOf, days);
  // The key is deleted rather than set to undefined: WHOOP replies in JSON, so
  // an unscored record simply has no `score` member. Setting it to undefined
  // produces a shape no API could return — and the source schema said so.
  const strip = (record, state) => {
    const { score, ...rest } = record;
    return { ...rest, score_state: state };
  };
  parts.sleep = parts.sleep.map((record, index) =>
    index % 2 === 0 ? strip(record, "PENDING_SCORE") : record
  );
  parts.recovery = parts.recovery.map((record, index) =>
    index % 3 === 0 ? strip(record, "UNSCORABLE") : record
  );
  parts.workouts = parts.workouts.map((record, index) =>
    index % 2 === 0 ? strip(record, "PENDING_SCORE") : record
  );
  return parts;
}

/** WHOOP itself says the composite is not trustworthy yet. */
function calibrating(asOf, days) {
  const parts = completeDocuments(asOf, days);
  parts.recovery = parts.recovery.map((record) => ({
    ...record,
    score: { ...record.score, user_calibrating: true }
  }));
  return parts;
}

/** Nights broken up badly: in-bed time far exceeds time asleep. */
function restlessNights(asOf, days) {
  const parts = completeDocuments(asOf, days);
  parts.sleep = parts.sleep.map((record, index) =>
    sleep(record.start.slice(0, 10), {
      asleepHours: 5.5,
      awakeHours: index % 2 === 0 ? 2.5 : 1.75,
      performance: 62
    })
  );
  return parts;
}

function sparseWear(asOf, days) {
  const parts = completeDocuments(asOf, days);
  const worn = (iso) => Number(iso.slice(9, 10)) % 3 === 0;
  parts.sleep = parts.sleep.filter((record) => worn(record.start));
  parts.recovery = parts.recovery.filter((record) => worn(record.created_at));
  parts.cycles = parts.cycles.filter((record) => worn(record.start));
  return parts;
}

const PROFILE = { timezone: "Asia/Taipei", fitnessLevel: "intermediate" };
const GOALS = [{ type: "half_marathon", label: "Half marathon", priority: 1 }];
const CONSTRAINTS = { availableMinutes: 60 };

const SCHEDULED_SESSION = {
  focus: "Tempo Run",
  type: "run",
  intensity: "high",
  durationMinutes: 60,
  muscleGroups: ["legs"]
};

export const WHOOP_SCENARIOS = [
  {
    id: "complete_documents",
    label: "Recovery, sleep, cycles and workouts, all SCORED",
    purpose: "Every signal the registry declares for WHOOP must come out, with the right unit and source.",
    days: 28,
    build: completeDocuments,
    expectRecovery: ["sleep", "hrv", "restingHeartRate"],
    expectSignals: ["sleep_duration_hours", "sleep_quality", "hrv_ms", "resting_hr_bpm", "vendor_readiness", "vendor_acute_load"]
  },
  {
    id: "pending_scores",
    label: "Half the records arrived before WHOOP scored them",
    purpose:
      "PENDING_SCORE and UNSCORABLE records carry no score object. Reading them as zero would report nights of no sleep and days of no strain — both wrong, both in the direction of 'this athlete is fine'.",
    days: 28,
    build: pendingScores,
    expectSignals: ["sleep_duration_hours", "hrv_ms"],
    expectNoZeroReadings: true
  },
  {
    id: "calibrating",
    label: "WHOOP is still calibrating the recovery score",
    purpose:
      "The composite is withheld while user_calibrating is true, because WHOOP says it is not accurate. The raw HRV and resting heart rate stay: they are measurements, and it is the score on top of them that is being withheld.",
    days: 28,
    build: calibrating,
    expectSignals: ["hrv_ms", "resting_hr_bpm", "sleep_duration_hours"],
    expectAbsent: ["vendor_readiness"]
  },
  {
    id: "restless_nights",
    label: "Broken nights, where in-bed time and asleep time diverge",
    purpose:
      "5h30m asleep inside 8h in bed. Reading in-bed time as sleep duration would overstate the night by two and a half hours, and it overstates most on the worst nights — pushing recovery up exactly when it should come down.",
    days: 28,
    build: restlessNights,
    expectSignals: ["sleep_duration_hours", "hrv_ms"],
    expectSleepHoursBelow: 6
  },
  {
    id: "sparse_wear",
    label: "The strap is worn on roughly one day in three",
    purpose: "Days with no record produce no reading, and coverage shrinks honestly.",
    days: 28,
    build: sparseWear,
    expectSignals: ["sleep_duration_hours", "hrv_ms"]
  }
];

export function buildWhoopDocuments(scenario, { asOf }) {
  return scenario.build(asOf, scenario.days);
}

export { PROFILE, GOALS, CONSTRAINTS, SCHEDULED_SESSION };
