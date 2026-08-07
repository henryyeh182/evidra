// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { stableId } from "../../../../db/src/id.js";

/**
 * Oura API v2 documents → Fitness Evidence Model.
 *
 * Written against Oura's own OpenAPI document, spec version 1.37
 * (https://cloud.ouraring.com/v2/static/json/openapi-1.37.json). Every field
 * read here was checked there; the quotations below are the spec's wording, not
 * a summary of it.
 *
 * The single fact that shapes this file: **Oura splits scores from
 * measurements, and they live on different endpoints.**
 *
 *   /usercollection/daily_sleep      PublicDailySleep — id, day, timestamp,
 *                                    score, contributors. No durations. No
 *                                    heart rate. It is a scorecard.
 *   /usercollection/sleep            PublicModifiedSleepModel — the night
 *                                    itself: total_sleep_duration, average_hrv,
 *                                    lowest_heart_rate, stage durations.
 *
 * Reading a duration off `daily_sleep` gets nothing, and reading a contributor
 * off it gets a 1-100 score wearing a physiological name. Both mistakes were in
 * our registry until the spec was read.
 *
 * We do not fetch any of this. The caller hands over documents it already
 * holds; this module only renames them into the canonical vocabulary.
 */

const DAY = 86400000;

/**
 * Which sleep periods count as a night.
 *
 * The spec's own definitions of PublicSleepType:
 *
 *   long_sleep  "sleep that is long enough (>3h) to automatically contribute
 *               to daily scores"          ← a night
 *   sleep       "user confirmed sleep / nap, min 15 minutes, max 3 hours"
 *   late_nap    a nap that ended after the 6pm sleep-day change
 *   rest        "Falsely detected sleep / nap, rejected in confirm prompt by
 *               user"                     ← not sleep at all
 *   deleted     "deleted sleep by user"
 *
 * Only `long_sleep` is taken as a night's recovery. A 40-minute afternoon nap
 * carries none of the overnight physiology the recovery score is built on, and
 * summing naps into a night's duration would report the athlete slept longer
 * than they did. `rest` and `deleted` are excluded outright: the user told Oura
 * those were not sleep.
 */
const NIGHT_TYPES = new Set(["long_sleep"]);

function dayToIso(day) {
  if (!day) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? `${day}T12:00:00Z` : String(day);
}

/**
 * The night record: durations, HRV and heart rate.
 *
 * `average_hrv` is the only millisecond HRV Oura publishes for a night. The
 * spec labels it "Average heart rate variability during sleep" and types it as
 * an integer. It is not `hrv_balance`, which is a readiness contributor scored
 * in [1, 100].
 *
 * `lowest_heart_rate` is emitted as `resting_hr_bpm` and that is our
 * substitution, not Oura's: **Oura publishes no resting-heart-rate field at
 * all.** The spec also notes the value is computed from 30-second samples. The
 * metadata says so on every reading rather than letting a downstream reader
 * assume Oura measured resting heart rate directly.
 */
export function normalizeOuraSleep(records = []) {
  const events = [];

  for (const record of records) {
    if (!NIGHT_TYPES.has(record.type)) continue;

    const day = record.day;
    const recordedAt = dayToIso(day) ?? record.bedtime_end;
    if (!recordedAt) continue;

    if (typeof record.total_sleep_duration === "number" && record.total_sleep_duration > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("oura", "sleep_duration_hours", day),
        type: "sleep_duration_hours",
        value: Number((record.total_sleep_duration / 3600).toFixed(2)),
        unit: "hours",
        recordedAt,
        source: "oura"
      });
    }

    // Nullable in the spec, and null on a night the ring could not measure it.
    // Absent stays absent: a night without an HRV reading is a night the
    // recovery score renormalizes around, not a night worth a filled-in number.
    if (typeof record.average_hrv === "number" && record.average_hrv > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("oura", "hrv_ms", day),
        type: "hrv_ms",
        value: record.average_hrv,
        unit: "ms",
        recordedAt,
        source: "oura"
      });
    }

    if (typeof record.lowest_heart_rate === "number" && record.lowest_heart_rate > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("oura", "resting_hr_bpm", day),
        type: "resting_hr_bpm",
        value: record.lowest_heart_rate,
        unit: "bpm",
        recordedAt,
        source: "oura",
        metadata: {
          // Named so a reader is never misled about whose number this is.
          derivedFrom: "sleep.lowest_heart_rate",
          note: "Oura publishes no resting heart rate; lowest overnight HR is our proxy."
        }
      });
    }
  }

  return events;
}

/**
 * The sleep scorecard.
 *
 * `score` is Oura's own composite for the night, and it comes in as a first
 * class vendor number rather than something we re-derive from the stage
 * durations we also read. The ring was on the finger; its assessment beats our
 * arithmetic.
 *
 * The `contributors` object is deliberately not read. Every field in it is
 * documented as "Contribution of X in range [1, 100]" — they are the score's
 * own workings, not measurements, and none of them has a canonical home.
 */
export function normalizeOuraDailySleep(records = []) {
  const events = [];

  for (const record of records) {
    const recordedAt = dayToIso(record.day) ?? record.timestamp;
    if (!recordedAt) continue;

    if (typeof record.score === "number" && record.score > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("oura", "sleep_quality", record.day),
        type: "sleep_quality",
        value: record.score,
        unit: "score_0_100",
        recordedAt,
        source: "oura"
      });
    }
  }

  return events;
}

/** Oura's daily readiness composite, kept labelled as theirs. */
export function normalizeOuraDailyReadiness(records = []) {
  const events = [];

  for (const record of records) {
    const recordedAt = dayToIso(record.day) ?? record.timestamp;
    if (!recordedAt) continue;

    if (typeof record.score === "number" && record.score > 0) {
      events.push({
        kind: "vendor_assessment",
        source: "oura",
        type: "vendor_readiness",
        value: record.score,
        unit: "score_0_100",
        recordedAt
      });
    }
  }

  return events;
}

/** Daily activity. Only `steps` has a canonical home; the activity score does not. */
export function normalizeOuraDailyActivity(records = []) {
  const events = [];

  for (const record of records) {
    const recordedAt = dayToIso(record.day) ?? record.timestamp;
    if (!recordedAt) continue;

    if (typeof record.steps === "number" && record.steps > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("oura", "steps", record.day),
        type: "steps",
        value: record.steps,
        unit: "count",
        recordedAt,
        source: "oura"
      });
    }
  }

  return events;
}

const ACTIVITY_TYPE_MAP = {
  running: "run",
  jogging: "run",
  cycling: "ride",
  walking: "walk",
  hiking: "walk",
  strength_training: "strength",
  weightlifting: "strength",
  yoga: "mobility",
  pilates: "mobility",
  stretching: "mobility",
  swimming: "ride"
};

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

/**
 * Workouts, which arrive without a load figure.
 *
 * PublicWorkout carries `activity`, `intensity` ("low" | "moderate" | "high"),
 * `calories`, `distance` and the two timestamps. There is no strain, no TSS and
 * no training load — **Oura does not compute one**, and neither will we.
 *
 * So `trainingLoad` is null. That is the whole point of the field being
 * nullable: a session with no load is reported through
 * `signalCoverage.training.missing` and contributes nothing to muscle fatigue
 * or to ATL/CTL. Deriving a number from duration and the intensity label would
 * put a value we invented into the same sum as Garmin's EPOC figure and
 * Strava's Relative Effort, and nothing downstream could tell them apart.
 */
export function normalizeOuraWorkouts(workouts = []) {
  return workouts
    .filter((workout) => workout.start_datetime && workout.end_datetime)
    .map((workout) => {
      const activity = String(workout.activity ?? "").toLowerCase();
      const type = ACTIVITY_TYPE_MAP[activity] || "other";
      const startedAt = new Date(workout.start_datetime).toISOString();
      const durationMinutes = Math.max(
        1,
        Math.round((new Date(workout.end_datetime) - new Date(workout.start_datetime)) / 60000)
      );

      return {
        kind: "workout",
        id: `oura_${workout.id ?? workout.start_datetime}`,
        type,
        name: workout.label || `Oura ${type}`,
        startedAt,
        durationMinutes,
        rpe: null,
        trainingLoad: null,
        muscleGroups: inferMuscleGroups(type),
        source: "oura",
        metadata: {
          ouraActivity: activity || null,
          // Oura's own low/moderate/high label. Carried as evidence, never
          // turned into a load number.
          intensity: workout.intensity ?? null,
          calories: workout.calories ?? null,
          distanceMeters: workout.distance ?? null,
          loadSource: "none_oura_publishes_no_load"
        }
      };
    });
}

/**
 * Assemble Oura documents into Fitness Evidence Model shape.
 *
 * @param {{ sleep?: object[], dailySleep?: object[], dailyReadiness?: object[], dailyActivity?: object[], workouts?: object[] }} parts
 * @param {{ sinceDays?: number, asOf?: string }} [options]
 */
export function buildOuraEvidence(parts = {}, options = {}) {
  const all = [
    ...normalizeOuraSleep(parts.sleep),
    ...normalizeOuraDailySleep(parts.dailySleep),
    ...normalizeOuraDailyReadiness(parts.dailyReadiness),
    ...normalizeOuraDailyActivity(parts.dailyActivity)
  ];
  const workouts = normalizeOuraWorkouts(parts.workouts);

  const asOf = options.asOf ? new Date(options.asOf).getTime() : Date.now();
  const cutoff = options.sinceDays ? asOf - options.sinceDays * DAY : null;
  const inWindow = (iso) => !cutoff || new Date(iso).getTime() >= cutoff;

  return {
    healthMetrics: all.filter((event) => event.kind === "health_metric" && inWindow(event.recordedAt)),
    vendorAssessments: all.filter((event) => event.kind === "vendor_assessment" && inWindow(event.recordedAt)),
    workouts: workouts.filter((workout) => inWindow(workout.startedAt))
  };
}
