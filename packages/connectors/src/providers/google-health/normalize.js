// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Google Health Takeout export → Fitness Evidence Model.
 *
 * What is actually usable differs sharply from what the export nominally
 * contains. Measured over one real 480-file export whose values arrived by
 * Garmin sync (2026-03-31 → 2026-07-30):
 *
 *   daily resting HR    47/120 days   ← the dependable one
 *   steps               ~every day, but from two recorders at once
 *   sleep               2 nights
 *   sleep score         0 rows  ← Fitbit does not score synced nights
 *   stress score        0 rows  ← same reason
 *   cardio load         0 on every session — sync loses the composite
 *
 * So a Google Health Takeout user whose values come from Garmin gets decisions
 * from resting HR plus per-session training load, and the empty composite
 * files surface as `signalCoverage` misses — not as invented middling scores.
 *
 * The dialect traps enforced here are named in
 * `VENDOR_SCHEMAS.google_health_export.quirks`; each guard cites its quirk.
 */

const DAY = 86400000;
const MINUTE = 60000;

/** "+08:00" → 480. Sign and half-hour offsets included. */
export function parseUtcOffsetMinutes(text) {
  const match = String(text ?? "").trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/**
 * Quirk `midnightTimestampsEncodeTheOffset`: daily files stamp each day at
 * local midnight expressed in UTC, so the UTC time-of-day *is* the offset.
 * 16:00Z → +8h (Taipei); 05:00Z → −5h. Resolved into (−12h, +14h], the range
 * real zones occupy — no caller-supplied timezone, nothing invented.
 */
export function decodeMidnightOffsetMinutes(isoInstant) {
  const date = new Date(isoInstant);
  if (Number.isNaN(date.getTime())) return null;
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const offset = (1440 - utcMinutes) % 1440;
  return offset > 14 * 60 ? offset - 1440 : offset;
}

/** The local calendar day an instant falls on, given an offset in minutes. */
function localDayOf(isoInstant, offsetMinutes) {
  const time = Date.parse(isoInstant);
  if (Number.isNaN(time)) return null;
  return new Date(time + (offsetMinutes ?? 0) * MINUTE).toISOString().slice(0, 10);
}

/** Day-level facts are stamped at noon UTC, same convention as the Garmin reader. */
const dayRecordedAt = (day) => `${day}T12:00:00Z`;

/** Quirk `monthlyJsonDatesAreMMDDYY`: "04/06/26 00:00:00" → "2026-04-06". */
export function monthlyJsonDateToDay(text) {
  const match = String(text ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2}) /);
  if (!match) return null;
  return `20${match[3]}-${match[1]}-${match[2]}`;
}

/**
 * The offset this export was lived in, taken from the export itself: the
 * per-row `utc_offset` columns first, the self-decoding midnight stamps
 * second. Null when the export carries no offset anywhere — callers then get
 * UTC day-bucketing, labelled as such, rather than a guessed timezone.
 */
export function deriveExportOffsetMinutes(parts = {}) {
  const carried = [
    ...(parts.exercises ?? []).map((row) => parseUtcOffsetMinutes(row.utc_offset)),
    ...(parts.sleeps ?? []).map((row) => parseUtcOffsetMinutes(row.end_utc_offset ?? row.start_utc_offset))
  ].filter((offset) => offset !== null);
  if (carried.length > 0) {
    const counts = new Map();
    for (const offset of carried) counts.set(offset, (counts.get(offset) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  for (const row of parts.dailyRestingHeartRate ?? []) {
    const decoded = decodeMidnightOffsetMinutes(row.timestamp);
    if (decoded !== null) return decoded;
  }
  return null;
}

// --- daily resting heart rate ---------------------------------------------

/**
 * Both spellings of the same fact — the CSV and the month-sliced JSON — land
 * here. The CSV wins when a day appears in both; the JSON fills days the CSV
 * does not have. Quirk `zeroIsNotMeasured`: 0 bpm is an unworn tracker.
 */
export function normalizeGoogleHealthRestingHeartRate(parts = {}) {
  const events = [];
  const covered = new Set();

  for (const row of parts.dailyRestingHeartRate ?? []) {
    const bpm = row["beats per minute"];
    if (typeof bpm !== "number" || bpm <= 0) continue;
    const offset = decodeMidnightOffsetMinutes(row.timestamp);
    const day = localDayOf(row.timestamp, offset);
    if (!day || covered.has(day)) continue;
    covered.add(day);
    events.push({
      kind: "health_metric",
      type: "resting_hr_bpm",
      value: bpm,
      unit: "bpm",
      recordedAt: dayRecordedAt(day),
      source: "google_health_connect"
    });
  }

  for (const entry of parts.restingHeartRateMonthly ?? []) {
    const bpm = entry?.value?.value;
    if (typeof bpm !== "number" || bpm <= 0) continue; // 0.0 sentinel — wall-to-wall in the observed export
    const day = monthlyJsonDateToDay(entry.dateTime);
    if (!day || covered.has(day)) continue;
    covered.add(day);
    events.push({
      kind: "health_metric",
      type: "resting_hr_bpm",
      value: bpm,
      unit: "bpm",
      recordedAt: dayRecordedAt(day),
      source: "google_health_connect"
    });
  }

  return events;
}

// --- steps ----------------------------------------------------------------

/**
 * Quirk `stepsArriveFromTwoRecordersAtOnce`: the same hours of the same day
 * arrive from both the wearable sync and the phone. Summing every row
 * double-counts the day, and no priority list survives into the export — so
 * the daily figure is the max of the per-recorder sums: never a double count,
 * never below the best single recorder.
 */
export function normalizeGoogleHealthSteps(parts = {}, { offsetMinutes = null } = {}) {
  const perDaySource = new Map(); // day → (source → sum)
  for (const row of parts.steps ?? []) {
    if (typeof row.steps !== "number" || row.steps <= 0) continue;
    const day = localDayOf(row.timestamp, offsetMinutes);
    if (!day) continue;
    const source = row["data source"] ?? "unknown";
    const bySource = perDaySource.get(day) ?? new Map();
    bySource.set(source, (bySource.get(source) ?? 0) + row.steps);
    perDaySource.set(day, bySource);
  }

  return [...perDaySource.entries()].map(([day, bySource]) => ({
    kind: "health_metric",
    type: "steps",
    value: Math.max(...bySource.values()),
    unit: "count",
    recordedAt: dayRecordedAt(day),
    source: "google_health_connect",
    metadata: {
      aggregation: "daily_max_across_sources",
      recorders: [...bySource.keys()].sort(),
      dayBoundary: offsetMinutes === null ? "utc" : "local"
    }
  }));
}

// --- sleep ----------------------------------------------------------------

/**
 * A night belongs to the local day the athlete woke up on — `sleep_end` plus
 * the row's own `end_utc_offset` (quirk `exercisesAreUtcWithOffsetColumn`).
 * Quirk `napsAreNotMarked`: no main-sleep flag survives into this export, so
 * every row is emitted; inventing a duration threshold to drop "naps" would be
 * an unsourced constant.
 */
export function normalizeGoogleHealthSleeps(parts = {}) {
  const events = [];
  for (const row of parts.sleeps ?? []) {
    if (typeof row.minutes_asleep !== "number" || row.minutes_asleep <= 0) continue;
    const instant = row.sleep_end ?? row.sleep_start;
    const offset = parseUtcOffsetMinutes(row.end_utc_offset ?? row.start_utc_offset);
    const day = localDayOf(instant, offset);
    if (!day) continue;
    events.push({
      kind: "health_metric",
      type: "sleep_duration_hours",
      value: Number((row.minutes_asleep / 60).toFixed(2)),
      unit: "hours",
      recordedAt: dayRecordedAt(day),
      source: "google_health_connect"
    });
  }
  return events;
}

/**
 * Fitbit's overnight composite, kept separate from duration on purpose: in the
 * observed export this file is header-only (quirk `syncLosesTheComposites`),
 * and a night timed by UserSleeps must not grow an invented quality score.
 */
export function normalizeGoogleHealthSleepScores(parts = {}, { offsetMinutes = null } = {}) {
  const events = [];
  for (const row of parts.sleepScores ?? []) {
    if (typeof row.overall_score !== "number" || row.overall_score <= 0) continue;
    const day = localDayOf(row.timestamp, offsetMinutes);
    if (!day) continue;
    events.push({
      kind: "health_metric",
      type: "sleep_quality",
      value: row.overall_score,
      unit: "score_0_100",
      recordedAt: dayRecordedAt(day),
      source: "google_health_connect"
    });
  }
  return events;
}

// --- stress ---------------------------------------------------------------

/**
 * Quirk `zeroIsNotMeasured` in composite form: a row with
 * `CALCULATION_FAILED: true` (or a 0 score) is Fitbit giving up, not a serene
 * athlete. In the observed export the file is header-only anyway.
 */
export function normalizeGoogleHealthStressScores(parts = {}) {
  const events = [];
  for (const row of parts.stressScores ?? []) {
    if (row.CALCULATION_FAILED === true) continue;
    if (typeof row.STRESS_SCORE !== "number" || row.STRESS_SCORE <= 0) continue;
    const day = String(row.DATE ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    events.push({
      kind: "health_metric",
      type: "stress",
      value: row.STRESS_SCORE,
      unit: "score_0_100",
      recordedAt: dayRecordedAt(day),
      source: "google_health_connect"
    });
  }
  return events;
}

// --- workouts -------------------------------------------------------------

/** Human labels this dialect uses, mapped like the Garmin reader maps typeKeys. */
const ACTIVITY_NAME_MAP = {
  run: "run",
  "outdoor run": "run",
  "treadmill run": "run",
  "trail run": "run",
  bike: "ride",
  "outdoor bike": "ride",
  "indoor bike": "ride",
  spinning: "ride",
  elliptical: "ride",
  swim: "ride",
  walk: "walk",
  hike: "walk",
  weights: "strength",
  workout: "strength",
  "strength training": "strength",
  "circuit training": "strength",
  yoga: "mobility",
  stretching: "mobility",
  "aerobic workout": "other",
  sport: "other"
};

function inferMuscleGroups(type) {
  if (type === "run" || type === "ride" || type === "walk") return ["legs"];
  if (type === "strength") return ["full_body"];
  if (type === "mobility") return ["hips", "core"];
  return [];
}

const positive = (value) => (typeof value === "number" && value > 0 ? value : null);

export function normalizeGoogleHealthExercises(parts = {}) {
  const workouts = [];
  for (const row of parts.exercises ?? []) {
    if (!row.exercise_start || !row.exercise_end) continue; // an undated session cannot sit on a load curve
    const started = Date.parse(row.exercise_start);
    const ended = Date.parse(row.exercise_end);
    if (Number.isNaN(started) || Number.isNaN(ended)) continue;

    const type = ACTIVITY_NAME_MAP[String(row.activity_name ?? "").toLowerCase()] ?? "other";
    const durationMinutes = Math.max(1, Math.round((ended - started) / MINUTE));

    // Load, in order of evidence quality (quirk `zeroIsNotMeasured` — every 0
    // below is "not measured", not a value):
    //   1. Fitbit's own Cardio Load composite when Fitbit computed it — the
    //      vendor's load is used as-is, not recomputed (same ruling as
    //      Garmin's activityTrainingLoad).
    //   2. Session active energy / 10, the same convention as the Apple Health
    //      reader — kcal is a measured signal, and the divisor matches so the
    //      two sources stay comparable.
    //   3. Nothing — an absent input stays absent, reported via loadSource.
    const cardioLoad = positive(row.tracker_cardio_load);
    const kcal = positive(row.tracker_total_calories) ?? positive(row.manually_logged_total_calories);
    const trainingLoad = cardioLoad !== null ? Math.round(cardioLoad) : kcal !== null ? Math.round(kcal / 10) : null;
    const loadSource = cardioLoad !== null ? "fitbit_cardio_load" : kcal !== null ? "active_energy" : "unavailable";

    const distanceMm = positive(row.tracker_total_distance_mm) ?? positive(row.manually_logged_total_distance_mm);

    workouts.push({
      kind: "workout",
      id: `google_health_${row.exercise_id ?? row.exercise_start}`,
      type,
      name: row.activity_name || `Google Health ${type}`,
      startedAt: new Date(started).toISOString(),
      durationMinutes,
      rpe: null, // the dialect has no RPE; absent stays absent
      trainingLoad,
      muscleGroups: inferMuscleGroups(type),
      source: "google_health_connect",
      metadata: {
        googleHealthActivityName: row.activity_name ?? null,
        logType: row.log_type ?? null,
        utcOffset: row.utc_offset ?? null,
        avgHr: positive(row.tracker_avg_heart_rate),
        maxHr: positive(row.tracker_peak_heart_rate),
        distanceMeters: distanceMm !== null ? Math.round(distanceMm / 1000) : null,
        totalEnergyKcal: kcal,
        loadSource
      }
    });
  }
  return workouts;
}

// --- assembly -------------------------------------------------------------

/**
 * Assemble parsed Takeout parts into Fitness Evidence Model shape.
 *
 * @param {ReturnType<import("./parse.js").parseGoogleHealthExport>} parts
 * @param {{ sinceDays?: number, asOf?: string, utcOffsetMinutes?: number }} [options]
 *   `utcOffsetMinutes` overrides the offset derived from the export itself —
 *   for the files that carry no per-row offset (steps, sleep scores).
 */
export function buildGoogleHealthEvidence(parts = {}, options = {}) {
  const offsetMinutes = options.utcOffsetMinutes ?? deriveExportOffsetMinutes(parts);

  const all = [
    ...normalizeGoogleHealthRestingHeartRate(parts),
    ...normalizeGoogleHealthSteps(parts, { offsetMinutes }),
    ...normalizeGoogleHealthSleeps(parts),
    ...normalizeGoogleHealthSleepScores(parts, { offsetMinutes }),
    ...normalizeGoogleHealthStressScores(parts)
  ];
  const workouts = normalizeGoogleHealthExercises(parts);

  const asOf = options.asOf ? new Date(options.asOf).getTime() : Date.now();
  const cutoff = options.sinceDays ? asOf - options.sinceDays * DAY : null;
  const inWindow = (iso) => !cutoff || new Date(iso).getTime() >= cutoff;

  return {
    healthMetrics: all.filter((event) => event.kind === "health_metric" && inWindow(event.recordedAt)),
    vendorAssessments: all.filter((event) => event.kind === "vendor_assessment" && inWindow(event.recordedAt)),
    workouts: workouts.filter((workout) => inWindow(workout.startedAt))
  };
}
