// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Google Health API v4 (REST) → Fitness Evidence Model.
//
// Moved here, unchanged, from scripts/import-google-health-api.js so the
// local connector assembly (packages/connectors/src/local/assembleLocalEvidence.js)
// can call the same reader/normalizer the standalone script already used —
// the script now delegates here instead of duplicating this logic. See that
// script's original header comment for the dialect notes (measured on one
// real account, 2026-08-06): exercise, resting HR and sleep carry a usable
// series; HRV, active-zone-minutes and vo2max do not exist in this account's
// write chain and stay absent.
//
// This is the *API* dialect of Google Health, not the Takeout dialect that
// packages/connectors/src/providers/google-health/ already reads — same
// platform, different shapes.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { LocalConnectorAdapter } from "../local.js";
import { stableId } from "../../../db/src/id.js";

const DEFAULT_RAW_DIR = "data/private/export_google_health/raw";
const MINUTE = 60000;
const SOURCE = "google_health_api";

/** Day-level facts are stamped at noon UTC, same convention as the Takeout reader. */
const dayRecordedAt = (day) => `${day}T12:00:00Z`;

/** "28800s" → 480 minutes. The API states offsets as a duration string. */
function offsetMinutes(text) {
  const match = String(text ?? "").match(/^(-?\d+(?:\.\d+)?)s$/);
  return match ? Math.round(Number(match[1]) / 60) : null;
}

/** "484.871002s" → 484871 ms. */
function durationMs(text) {
  const match = String(text ?? "").match(/^(-?\d+(?:\.\d+)?)s$/);
  return match ? Number(match[1]) * 1000 : null;
}

function localDayOf(isoInstant, minutes) {
  const time = Date.parse(isoInstant);
  if (Number.isNaN(time)) return null;
  return new Date(time + (minutes ?? 0) * MINUTE).toISOString().slice(0, 10);
}

/** The API returns integer-valued fields as JSON strings. Absent stays absent. */
function num(value) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const positive = (value) => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

// --- exercise -------------------------------------------------------------

// ExerciseType enum → the evidence model's own vocabulary. Anything unmapped
// stays "other" rather than being forced into a neighbouring bucket.
const EXERCISE_TYPE_MAP = {
  RUNNING: "run",
  TREADMILL_RUNNING: "run",
  TRAIL_RUNNING: "run",
  BIKING: "ride",
  MOUNTAIN_BIKING: "ride",
  SPINNING: "ride",
  WALKING: "walk",
  HIKING: "walk",
  WEIGHTS: "strength",
  STRENGTH_TRAINING: "strength",
  CIRCUIT_TRAINING: "strength",
  YOGA: "mobility",
  PILATES: "mobility",
  STRETCHING: "mobility"
};

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

function normalizeExercises(dataPoints) {
  const workouts = [];
  for (const point of dataPoints) {
    const exercise = point.exercise;
    if (!exercise?.interval?.startTime) continue; // an undated session cannot sit on a load curve

    const started = Date.parse(exercise.interval.startTime);
    if (Number.isNaN(started)) continue;

    // activeDuration excludes pauses, so it beats end − start when present.
    const active = durationMs(exercise.activeDuration);
    const spanned = Date.parse(exercise.interval.endTime ?? "") - started;
    const ms = active ?? (Number.isFinite(spanned) ? spanned : null);
    if (ms === null) continue;

    const metrics = exercise.metricsSummary ?? {};
    const kcal = positive(metrics.caloriesKcal);

    // Load, in order of evidence quality:
    //   1. A vendor composite — this dialect has none. `exerciseMetadata` is
    //      empty on every measured session and no cardio-load field exists.
    //   2. Session active energy / 10, the same divisor the Takeout reader and
    //      the Apple Health reader use, so the three stay comparable. Never
    //      mix this series with a Garmin/Strava load series: ACWR is a ratio
    //      within one series, and two scales in one curve make it meaningless.
    //   3. Nothing — absent stays absent, reported through loadSource.
    const trainingLoad = kcal !== null ? Math.round(kcal / 10) : null;
    const loadSource = kcal !== null ? "active_energy" : "unavailable";

    const type = EXERCISE_TYPE_MAP[String(exercise.exerciseType ?? "").toUpperCase()] ?? "other";
    const distanceMm = positive(metrics.distanceMillimeters);

    workouts.push({
      kind: "workout",
      id: stableId(SOURCE, point.name?.split("/").pop() ?? exercise.interval.startTime),
      type,
      name: exercise.displayName || `Google Health ${type}`,
      startedAt: new Date(started).toISOString(),
      durationMinutes: Math.max(1, Math.round(ms / MINUTE)),
      rpe: null, // the dialect has no RPE; absent stays absent
      trainingLoad,
      muscleGroups: inferMuscleGroups(type),
      source: SOURCE,
      metadata: {
        googleHealthExerciseType: exercise.exerciseType ?? null,
        // Who actually wrote the row. Everything measured so far arrives as
        // com.garmin.connect.mobile over HEALTH_KIT, so the provenance is a
        // three-hop chain and worth carrying.
        writer: point.dataSource?.application?.packageName ?? null,
        platform: point.dataSource?.platform ?? null,
        avgHr: positive(metrics.averageHeartRateBeatsPerMinute),
        steps: positive(metrics.steps),
        distanceMeters: distanceMm !== null ? Math.round(distanceMm / 1000) : null,
        totalEnergyKcal: kcal,
        loadSource
      }
    });
  }
  return workouts;
}

// --- daily resting heart rate ---------------------------------------------

/** The API states daily dates as {year, month, day}, not an ISO string. */
function civilDay(date) {
  if (!date?.year || !date?.month || !date?.day) return null;
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function normalizeRestingHeartRate(dataPoints) {
  const events = [];
  const covered = new Set();
  for (const point of dataPoints) {
    const row = point.dailyRestingHeartRate;
    const bpm = positive(row?.beatsPerMinute); // 0 is an unworn tracker, not a value
    const day = civilDay(row?.date);
    if (bpm === null || !day || covered.has(day)) continue;
    covered.add(day);
    events.push({
      kind: "health_metric",
      // Every event needs a unique id. applyNormalizedEventsToContext dedupes
      // with `item.id === metric.id`, so a batch of id-less metrics all match
      // the first undefined slot and overwrite each other down to one.
      id: stableId(SOURCE, "resting_hr_bpm", day),
      type: "resting_hr_bpm",
      value: bpm,
      unit: "bpm",
      recordedAt: dayRecordedAt(day),
      source: SOURCE,
      metadata: { writer: point.dataSource?.application?.packageName ?? null }
    });
  }
  return events;
}

// --- daily heart rate variability ------------------------------------------

/**
 * Per the API reference, a dailyHeartRateVariability point sets at least one
 * of averageHeartRateVariabilityMilliseconds, nonRemHeartRateBeatsPerMinute,
 * entropy, or deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds.
 * Only averageHeartRateVariabilityMilliseconds maps to Evidra's hrv_ms — the
 * other three have no defined mapping, so a point that sets only those stays
 * absent rather than being guessed at.
 */
function normalizeHeartRateVariability(dataPoints) {
  const events = [];
  const covered = new Set();
  for (const point of dataPoints) {
    const row = point.dailyHeartRateVariability;
    const ms = positive(row?.averageHeartRateVariabilityMilliseconds);
    const day = civilDay(row?.date);
    if (ms === null || !day || covered.has(day)) continue;
    covered.add(day);
    events.push({
      kind: "health_metric",
      id: stableId(SOURCE, "hrv_ms", day),
      type: "hrv_ms",
      value: ms,
      unit: "ms",
      recordedAt: dayRecordedAt(day),
      source: SOURCE,
      metadata: { writer: point.dataSource?.application?.packageName ?? null }
    });
  }
  return events;
}

// --- sleep ----------------------------------------------------------------

/**
 * A night is attributed to the local day it *ends* on — the morning the athlete
 * wakes up is the day the decision is made for. `minutesAsleep` excludes awake
 * time, so it is duration, not time in bed.
 *
 * Sleep *quality* has no source here: the API exposes no sleep score, and the
 * stage summary is not one. It stays absent and lands in signalCoverage.
 */
function normalizeSleeps(dataPoints) {
  const events = [];
  const covered = new Set();
  for (const point of dataPoints) {
    const sleep = point.sleep;
    const minutes = positive(sleep?.summary?.minutesAsleep);
    const interval = sleep?.interval;
    if (minutes === null || !interval?.endTime) continue;
    if (sleep?.metadata?.mainSleep === false) continue; // naps do not define the night

    const day = localDayOf(interval.endTime, offsetMinutes(interval.endUtcOffset));
    if (!day || covered.has(day)) continue;
    covered.add(day);

    const stages = Object.fromEntries(
      (sleep.summary.stagesSummary ?? []).map((stage) => [stage.type, num(stage.minutes)])
    );

    events.push({
      kind: "health_metric",
      id: stableId(SOURCE, "sleep_duration_hours", day),
      type: "sleep_duration_hours",
      value: Number((minutes / 60).toFixed(2)),
      unit: "hours",
      recordedAt: dayRecordedAt(day),
      source: SOURCE,
      metadata: {
        writer: point.dataSource?.application?.packageName ?? null,
        minutesAwake: num(sleep.summary.minutesAwake),
        stageMinutes: stages
      }
    });
  }
  return events;
}

// --- assembly -------------------------------------------------------------

/**
 * Steps are deliberately not read here. The list endpoint returns intraday
 * intervals 50 rows to a page behind a nextPageToken, and the same day arrives
 * from both the phone and the watch — summing the rows double-counts the day.
 * A correct daily figure needs dailyRollUp, which is not measured yet. An
 * absent signal beats a wrong one.
 */
export function buildGoogleHealthApiEvidence(raw) {
  const workouts = normalizeExercises(raw.exercise ?? []);
  const healthMetrics = [
    ...normalizeRestingHeartRate(raw.restingHeartRate ?? []),
    ...normalizeHeartRateVariability(raw.heartRateVariability ?? []),
    ...normalizeSleeps(raw.sleep ?? [])
  ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return { healthMetrics, workouts: workouts.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
}

// --- raw file loading -----------------------------------------------------

// Whichever of these exists wins, in order. The filenames are whatever the
// probing session happened to write; an error payload counts as absent.
const RAW_FILES = {
  exercise: ["exercise.json"],
  restingHeartRate: ["resting-hr.json", "daily-resting-heart-rate.json"],
  heartRateVariability: ["daily-heart-rate-variability.json", "r-daily-heart-rate-variability.json"],
  sleep: ["sleep-nofilter.json", "sleep.json"]
};

async function loadDataPoints(names, present, rawDir) {
  for (const name of names) {
    if (!present.has(name)) continue;
    const body = JSON.parse(await readFile(join(rawDir, name), "utf8"));
    if (body.error) continue; // a 4xx payload is not evidence
    return { name, dataPoints: body.dataPoints ?? [], truncated: Boolean(body.nextPageToken) };
  }
  return { name: null, dataPoints: [], truncated: false };
}

/**
 * Reads whatever raw Google Health API v4 responses are present in `rawDir`
 * (put there by Codelab.http or curl — see data/private/export_google_health/README).
 * Returns `{ raw, report }`: `raw` is the {exercise, restingHeartRate,
 * heartRateVariability, sleep} shape buildGoogleHealthApiEvidence expects;
 * `report` records which filename served each key and whether it was
 * truncated, for callers that want to say so.
 */
export async function readGoogleHealthApiRawFolder(rawDir) {
  let present;
  try {
    present = new Set(await readdir(rawDir));
  } catch {
    return { raw: null, report: null };
  }

  const raw = {};
  const report = {};
  for (const [key, names] of Object.entries(RAW_FILES)) {
    const loaded = await loadDataPoints(names, present, rawDir);
    raw[key] = loaded.dataPoints;
    report[key] = { file: loaded.name, count: loaded.dataPoints.length, truncated: loaded.truncated };
  }
  return { raw, report };
}

const DEFAULT_RAW_SUBDIR = DEFAULT_RAW_DIR;

/**
 * Reads the newest raw Google Health API responses under `rawDir` and
 * normalizes them. There is no single "export file" to pick a latest of —
 * the raw folder holds one JSON response per data type, each already the
 * most recent pull (re-running Codelab.http overwrites in place) — so this
 * reads whatever is currently there rather than scanning for a newest file.
 */
export class GoogleHealthApiLocalConnector extends LocalConnectorAdapter {
  constructor({ rawDir = DEFAULT_RAW_SUBDIR } = {}) {
    super({ provider: "google_health_api" });
    this.rawDir = rawDir;
  }

  async pullNormalizedEvents() {
    const { raw } = await readGoogleHealthApiRawFolder(this.rawDir);
    if (!raw) return [];
    const evidence = buildGoogleHealthApiEvidence(raw);
    return [...evidence.healthMetrics, ...evidence.workouts];
  }
}
