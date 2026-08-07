// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { stableId } from "../../../../db/src/id.js";

/**
 * WHOOP API documents → Fitness Evidence Model.
 *
 * Written against WHOOP's own OpenAPI document
 * (https://api.prod.whoop.com/developer/doc/openapi.json). The quotations below
 * are the spec's wording.
 *
 * Two facts shape this file.
 *
 * **1. `score_state` gates everything.** Sleep, Recovery, Cycle and Workout all
 * carry it, and the spec is explicit: `SCORED` "means the ... was scored and
 * the measurement values will be present", while `PENDING_SCORE` and
 * `UNSCORABLE` mean it was not. An unscored record still arrives, with `score`
 * absent. Reading it as zero would report a night of no sleep and a day of no
 * strain — the two readings most likely to change a decision, both wrong, both
 * in the direction of "this athlete is fine". Every normalizer here refuses
 * anything that is not `SCORED`.
 *
 * **2. There is no "time asleep" field.** `stage_summary` reports
 * `total_in_bed_time_milli` ("Total time the user spent in bed") beside
 * `total_awake_time_milli` and `total_no_data_time_milli`. In-bed time
 * overstates every night, and overstates it most on the nights the athlete slept
 * worst — precisely when the recovery score should be falling. Asleep time is
 * the three sleep stages added together, which is what this module does.
 *
 * We do not fetch any of this. The caller hands over documents it already
 * holds; this module only renames them into the canonical vocabulary.
 */

const DAY = 86400000;

/** The spec's own gate. Anything else means the score fields are not there. */
function isScored(record) {
  return record?.score_state === "SCORED" && record.score && typeof record.score === "object";
}

/** WHOOP timestamps are ISO 8601 with a separate `timezone_offset` string. */
function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Recovery: HRV, resting heart rate and WHOOP's own recovery score.
 *
 * `user_calibrating` is a second gate on top of `score_state`, and it is
 * WHOOP's equivalent of Garmin's `level: "NONE"`: "True if the user is still
 * calibrating and not enough data is available in WHOOP to provide an accurate
 * recovery." The composite is withheld while it is true, because laundering a
 * score WHOOP itself calls inaccurate into our confidence figure is exactly the
 * move the coverage model exists to prevent.
 *
 * The two raw measurements are kept even while calibrating. They are
 * measurements — HRV in milliseconds and a heart rate — and nothing about the
 * calibration state makes them wrong; it is the composite built on top of them
 * that WHOOP is not yet standing behind.
 */
export function normalizeWhoopRecovery(records = []) {
  const events = [];

  for (const record of records) {
    if (!isScored(record)) continue;
    const recordedAt = toIso(record.created_at ?? record.updated_at);
    if (!recordedAt) continue;

    const score = record.score;
    const day = recordedAt.slice(0, 10);

    // "measured using Root Mean Square of Successive Differences (RMSSD), in
    // milliseconds" — a float in the spec, so it is not rounded here.
    if (typeof score.hrv_rmssd_milli === "number" && score.hrv_rmssd_milli > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("whoop", "hrv_ms", day),
        type: "hrv_ms",
        value: Number(score.hrv_rmssd_milli.toFixed(1)),
        unit: "ms",
        recordedAt,
        source: "whoop",
        metadata: { method: "rmssd" }
      });
    }

    if (typeof score.resting_heart_rate === "number" && score.resting_heart_rate > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("whoop", "resting_hr_bpm", day),
        type: "resting_hr_bpm",
        value: Math.round(score.resting_heart_rate),
        unit: "bpm",
        recordedAt,
        source: "whoop"
      });
    }

    if (score.user_calibrating === true) continue;

    // "Percentage (0-100%) that reflects how well prepared the user's body is
    // to take on Strain."
    if (typeof score.recovery_score === "number" && score.recovery_score > 0) {
      events.push({
        kind: "vendor_assessment",
        source: "whoop",
        type: "vendor_readiness",
        value: Math.round(score.recovery_score),
        unit: "score_0_100",
        recordedAt
      });
    }
  }

  return events;
}

/**
 * Sleep: duration from the stages, quality from WHOOP's performance percentage.
 *
 * Naps are excluded on the record's own `nap` boolean — "If true, this sleep
 * activity was a nap for the user". A nap carries none of the overnight
 * physiology a night's recovery rests on, and adding one to the night would
 * report more sleep than the athlete got.
 *
 * `sleep_performance_percentage` is mapped to `sleep_quality` because that is
 * the nearest canonical slot, but the spec defines it as "A percentage (0-100%)
 * of the time a user is asleep over the amount of sleep the user needed" — an
 * attainment ratio, not a quality judgement. It also "may not be reported if
 * WHOOP does not have enough data about a user yet", so its absence is a
 * genuine gap and never a zero.
 */
export function normalizeWhoopSleep(records = []) {
  const events = [];

  for (const record of records) {
    if (!isScored(record)) continue;
    if (record.nap === true) continue;

    const recordedAt = toIso(record.end ?? record.start);
    if (!recordedAt) continue;

    const day = recordedAt.slice(0, 10);
    const stages = record.score.stage_summary;

    if (stages) {
      const asleepMilli =
        (stages.total_light_sleep_time_milli ?? 0) +
        (stages.total_slow_wave_sleep_time_milli ?? 0) +
        (stages.total_rem_sleep_time_milli ?? 0);

      // All three stages absent is not a night of zero sleep, it is a night
      // WHOOP did not stage. Only a positive sum is a measurement.
      if (asleepMilli > 0) {
        events.push({
          kind: "health_metric",
          id: stableId("whoop", "sleep_duration_hours", day),
          type: "sleep_duration_hours",
          value: Number((asleepMilli / 3600000).toFixed(2)),
          unit: "hours",
          recordedAt,
          source: "whoop",
          metadata: {
            // Said out loud because the field that looks like it would do this
            // job does not: in-bed time is not sleep time.
            derivedFrom: "light + slow_wave + rem",
            inBedMinutes:
              typeof stages.total_in_bed_time_milli === "number"
                ? Math.round(stages.total_in_bed_time_milli / 60000)
                : null,
            disturbanceCount: stages.disturbance_count ?? null
          }
        });
      }
    }

    const performance = record.score.sleep_performance_percentage;
    if (typeof performance === "number" && performance > 0) {
      events.push({
        kind: "health_metric",
        id: stableId("whoop", "sleep_quality", day),
        type: "sleep_quality",
        value: Math.round(performance),
        unit: "score_0_100",
        recordedAt,
        source: "whoop",
        metadata: { basis: "sleep_performance_percentage_attainment_ratio" }
      });
    }
  }

  return events;
}

/**
 * Cycles carry day strain — WHOOP's cardiovascular load, "scored on a scale
 * from 0 to 21".
 *
 * A cycle without an `end` is the one the athlete is currently inside. Its
 * strain is still accumulating, so it is reported like any other reading but
 * flagged, rather than being dropped: a partial day is real evidence about how
 * the day has gone so far.
 */
export function normalizeWhoopCycles(records = []) {
  const events = [];

  for (const record of records) {
    if (!isScored(record)) continue;
    const recordedAt = toIso(record.start);
    if (!recordedAt) continue;

    if (typeof record.score.strain === "number" && record.score.strain > 0) {
      events.push({
        kind: "vendor_assessment",
        source: "whoop",
        type: "vendor_acute_load",
        value: Number(record.score.strain.toFixed(2)),
        unit: "load",
        recordedAt,
        metadata: { scale: "0-21", inProgress: !record.end }
      });
    }
  }

  return events;
}

const SPORT_TYPE_MAP = {
  running: "run",
  trail_running: "run",
  cycling: "ride",
  spin: "ride",
  walking: "walk",
  hiking: "walk",
  weightlifting: "strength",
  functional_fitness: "strength",
  yoga: "mobility",
  pilates: "mobility",
  swimming: "ride"
};

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

/**
 * Workouts, with strain as the load figure.
 *
 * `score.strain` is WHOOP's per-workout cardiovascular load and it is the one
 * number here that belongs in `trainingLoad`. It is on WHOOP's own 0-21 scale,
 * which is not the same scale as Garmin's EPOC load or Strava's Relative
 * Effort — every source's load is its own vendor's, and `loadSource` records
 * whose.
 *
 * `percent_recorded` is carried through: "Percentage (0-100%) of heart rate
 * data WHOOP received during the workout". A strain computed from half a trace
 * is a weaker figure than one computed from all of it, and a caller deciding
 * how much to trust the session should be able to see that.
 *
 * An unscored workout gets no load at all rather than a duration estimate. It
 * then travels as a session with no load, which is what
 * `signalCoverage.training.missing` is for.
 */
export function normalizeWhoopWorkouts(workouts = []) {
  return workouts
    .filter((workout) => workout.start && workout.end)
    .map((workout) => {
      const sport = String(workout.sport_name ?? "").toLowerCase();
      const type = SPORT_TYPE_MAP[sport] || "other";
      const startedAt = toIso(workout.start);
      const durationMinutes = Math.max(
        1,
        Math.round((new Date(workout.end) - new Date(workout.start)) / 60000)
      );

      const scored = isScored(workout);
      const strain = scored && typeof workout.score.strain === "number" ? workout.score.strain : null;

      return {
        kind: "workout",
        id: `whoop_${workout.id ?? workout.start}`,
        type,
        name: workout.sport_name || `WHOOP ${type}`,
        startedAt,
        durationMinutes,
        rpe: null,
        trainingLoad: strain === null ? null : Number(strain.toFixed(2)),
        muscleGroups: inferMuscleGroups(type),
        source: "whoop",
        metadata: {
          whoopSport: sport || null,
          avgHr: scored ? workout.score.average_heart_rate ?? null : null,
          maxHr: scored ? workout.score.max_heart_rate ?? null : null,
          distanceMeters: scored ? workout.score.distance_meter ?? null : null,
          percentRecorded: scored ? workout.score.percent_recorded ?? null : null,
          loadSource: strain === null ? "none_unscored_workout" : "whoop_strain_0_21"
        }
      };
    });
}

/**
 * Assemble WHOOP documents into Fitness Evidence Model shape.
 *
 * @param {{ recovery?: object[], sleep?: object[], cycles?: object[], workouts?: object[] }} parts
 * @param {{ sinceDays?: number, asOf?: string }} [options]
 */
export function buildWhoopEvidence(parts = {}, options = {}) {
  const all = [
    ...normalizeWhoopRecovery(parts.recovery),
    ...normalizeWhoopSleep(parts.sleep),
    ...normalizeWhoopCycles(parts.cycles)
  ];
  const workouts = normalizeWhoopWorkouts(parts.workouts);

  const asOf = options.asOf ? new Date(options.asOf).getTime() : Date.now();
  const cutoff = options.sinceDays ? asOf - options.sinceDays * DAY : null;
  const inWindow = (iso) => !cutoff || new Date(iso).getTime() >= cutoff;

  return {
    healthMetrics: all.filter((event) => event.kind === "health_metric" && inWindow(event.recordedAt)),
    vendorAssessments: all.filter((event) => event.kind === "vendor_assessment" && inWindow(event.recordedAt)),
    workouts: workouts.filter((workout) => inWindow(workout.startedAt))
  };
}
