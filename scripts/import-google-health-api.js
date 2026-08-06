// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Google Health API v4 (REST) → Fitness Evidence Model.
//
// This is the *API* dialect of Google Health, not the Takeout dialect that
// packages/connectors/src/providers/google-health/ already reads. Same
// platform, different shapes: the export ships CSV/JSON files with Fitbit
// column names, the API ships typed dataPoints under
// https://health.googleapis.com/v4/users/me/dataTypes/<kebab-name>/dataPoints.
//
// It reads whatever raw responses are already in data/private/google-health/raw/
// (put there by Codelab.http or by curl), converts, writes evidence.json, and
// prints a Semantic Fitness State computed from it. Nothing here is committed;
// nothing here is on the server's import path.
//
// Measured on one real account, 2026-08-06 (Garmin watch → Garmin Connect →
// Apple HealthKit → Google Health → API, `platform: HEALTH_KIT`):
//
//   exercise                  9 sessions, caloriesKcal on 9/9  ← the load line
//   daily-resting-heart-rate  13 days over a 24-day window
//   sleep                     6 nights, full stage summary
//   heart-rate-variability    0   ← Garmin Connect's HealthKit write list has
//   daily-heart-rate-variability 0   no HRV entry at all, so nothing upstream
//   active-zone-minutes       0   ← needs a Fitbit/Pixel device
//   vo2-max / daily-vo2-max   0
//   exerciseMetadata          {} on all 9 — no `intensity` field exists
//
// So this dialect carries a complete training side and a recovery side of
// resting HR plus sleep. hrv lands in signalCoverage.recovery.missing, which
// is the point: an absent signal is reported, never guessed.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { applyNormalizedEventsToContext } from "../packages/connectors/src/index.js";
import { generateSemanticFitnessState } from "../packages/semantic-engine/src/index.js";
import { stableId } from "../packages/db/src/id.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const baseDir = join(rootDir, "data/private/google-health");
const rawDir = join(baseDir, "raw");
const outputPath = join(baseDir, "evidence.json");
const privateProfilePath = join(rootDir, "data/private/my-user-context.json");
const demoProfilePath = join(rootDir, "data/seeds/sample-user-context.json");

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
function buildEvidence(raw) {
  const workouts = normalizeExercises(raw.exercise);
  const healthMetrics = [
    ...normalizeRestingHeartRate(raw.restingHeartRate),
    ...normalizeSleeps(raw.sleep)
  ].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return { healthMetrics, workouts: workouts.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) };
}

// --- raw file loading -----------------------------------------------------

// Whichever of these exists wins, in order. The filenames are whatever the
// probing session happened to write; an error payload counts as absent.
const RAW_FILES = {
  exercise: ["exercise.json"],
  restingHeartRate: ["resting-hr.json", "daily-resting-heart-rate.json"],
  sleep: ["sleep-nofilter.json", "sleep.json"]
};

async function loadDataPoints(names, present) {
  for (const name of names) {
    if (!present.has(name)) continue;
    const body = JSON.parse(await readFile(join(rawDir, name), "utf8"));
    if (body.error) continue; // a 4xx payload is not evidence
    return { name, dataPoints: body.dataPoints ?? [], truncated: Boolean(body.nextPageToken) };
  }
  return { name: null, dataPoints: [], truncated: false };
}

async function main() {
  let present;
  try {
    present = new Set(await readdir(rawDir));
  } catch {
    console.log(`No raw responses at:\n  ${rawDir}\n`);
    console.log("Run the requests in data/private/google-health/Codelab.http first.");
    process.exitCode = 1;
    return;
  }

  const raw = {};
  for (const [key, names] of Object.entries(RAW_FILES)) {
    const loaded = await loadDataPoints(names, present);
    raw[key] = loaded.dataPoints;
    const from = loaded.name ? `${loaded.name}` : "(absent)";
    const note = loaded.truncated ? " — TRUNCATED, more pages exist" : "";
    console.log(`  ${key.padEnd(18)} ${String(loaded.dataPoints.length).padStart(3)} dataPoints  ${from}${note}`);
  }

  const evidence = buildEvidence(raw);
  const withLoad = evidence.workouts.filter((w) => w.trainingLoad !== null).length;
  console.log(
    `\n  normalized: ${evidence.workouts.length} workouts (${withLoad} with load), ` +
      `${evidence.healthMetrics.length} health metrics`
  );

  const types = new Set(evidence.healthMetrics.map((m) => m.type));
  console.log(`  metric types present: ${[...types].join(", ") || "(none)"}`);
  for (const expected of ["hrv_ms", "sleep_quality", "stress"]) {
    if (!types.has(expected)) console.log(`  absent: ${expected} — no source in this dialect`);
  }

  await writeFile(outputPath, JSON.stringify(evidence, null, 2));
  console.log(`\n  wrote ${outputPath} (git-ignored)`);

  // Prefer your real, git-ignored profile; fall back to the demo seed so the
  // script still runs out of the box.
  const usingRealProfile = present && (await fileExists(privateProfilePath));
  const profilePath = usingRealProfile ? privateProfilePath : demoProfilePath;
  const context = JSON.parse(await readFile(profilePath, "utf8"));
  console.log(`  profile: ${usingRealProfile ? "data/private/my-user-context.json (yours)" : "demo seed"}`);

  const events = [...evidence.healthMetrics, ...evidence.workouts];
  const merged = applyNormalizedEventsToContext(context, events);

  const latest = events.map((e) => e.recordedAt ?? e.startedAt).sort().at(-1);
  if (!latest) {
    console.log("\nNo dated evidence — nothing to compute a state from.");
    return;
  }
  const date = latest.slice(0, 10);
  const state = generateSemanticFitnessState(merged, { date, timezone: context.user?.timezone });

  console.log(`\nSemantic Fitness State from your Google Health data (${date}):`);
  console.log(`  recovery ${state.recoveryScore}  readiness ${state.readinessScore}  fatigue ${state.fatigueScore}`);
  console.log(`  recommended focus: ${state.recommendedFocus}`);
  console.log(`  confidence: ${state.confidence}`);
  if (state.signalCoverage) {
    console.log(`  signalCoverage: ${JSON.stringify(state.signalCoverage)}`);
  }
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
