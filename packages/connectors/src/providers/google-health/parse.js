/**
 * Google Health Takeout export — the file-splitting half of the reader.
 *
 * The archive is ~480 files across ~28 folders, of which seven kinds carry
 * evidence. This module only classifies files and coerces cells; every dialect
 * trap it guards against is named in
 * `VENDOR_SCHEMAS.google_health_export.quirks`, and the semantic work (offset
 * decoding, sentinel filtering, dual-recorder de-duplication) lives in
 * ./normalize.js so it can be read against the registry entry side by side.
 *
 * One trap is load-bearing enough to restate: this is the *Takeout* dialect of
 * Google Health. It is not Health Connect record types, and it is not a Garmin
 * export even when every row's `data source` says Garmin — values and dialect
 * travel separately.
 */

import { parseCsvRows } from "../strava/parseExport.js"; // generic RFC4180-ish reader, not Strava-specific

// --- value coercion -------------------------------------------------------

const blank = (value) => value === undefined || value === null || String(value).trim() === "";

/** Empty cells mean "the export had nothing here", which is not the same as zero. */
const num = (value) => {
  if (blank(value)) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const str = (value) => (blank(value) ? null : String(value).trim());

const bool = (value) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1" || text === "1.0") return true;
  if (text === "false" || text === "0" || text === "0.0") return false;
  return null;
};

/** Header-keyed reader — this dialect never repeats a header name (unlike Strava's). */
function parseKeyedCsv(text) {
  const rows = parseCsvRows(text ?? "");
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

// --- per-file row shapes --------------------------------------------------

const asDailyRestingHeartRate = (row) => ({
  timestamp: str(row.timestamp),
  "beats per minute": num(row["beats per minute"]),
  "data source": str(row["data source"])
});

const asSteps = (row) => ({
  timestamp: str(row.timestamp),
  steps: num(row.steps),
  "data source": str(row["data source"])
});

const asExercise = (row) => ({
  exercise_id: str(row.exercise_id),
  exercise_start: str(row.exercise_start),
  exercise_end: str(row.exercise_end),
  utc_offset: str(row.utc_offset),
  activity_name: str(row.activity_name),
  log_type: str(row.log_type),
  tracker_total_calories: num(row.tracker_total_calories),
  tracker_total_distance_mm: num(row.tracker_total_distance_mm),
  tracker_avg_heart_rate: num(row.tracker_avg_heart_rate),
  tracker_peak_heart_rate: num(row.tracker_peak_heart_rate),
  tracker_cardio_load: num(row.tracker_cardio_load),
  manually_logged_total_calories: num(row.manually_logged_total_calories),
  manually_logged_total_distance_mm: num(row.manually_logged_total_distance_mm)
});

const asSleep = (row) => ({
  sleep_id: str(row.sleep_id),
  sleep_type: str(row.sleep_type),
  minutes_asleep: num(row.minutes_asleep),
  minutes_awake: num(row.minutes_awake),
  start_utc_offset: str(row.start_utc_offset),
  sleep_start: str(row.sleep_start),
  end_utc_offset: str(row.end_utc_offset),
  sleep_end: str(row.sleep_end)
});

const asSleepScore = (row) => ({
  sleep_log_entry_id: str(row.sleep_log_entry_id),
  timestamp: str(row.timestamp),
  overall_score: num(row.overall_score),
  deep_sleep_in_minutes: num(row.deep_sleep_in_minutes),
  resting_heart_rate: num(row.resting_heart_rate),
  restlessness: num(row.restlessness)
});

const asStressScore = (row) => ({
  DATE: str(row.DATE),
  STRESS_SCORE: num(row.STRESS_SCORE),
  STATUS: str(row.STATUS),
  CALCULATION_FAILED: bool(row.CALCULATION_FAILED)
});

// --- file classification --------------------------------------------------

/**
 * Which part of the parsed export a file feeds, recognized by basename so the
 * caller may pass paths with or without the Takeout folder structure. Note
 * `UserSleeps_` does not match `UserSleepStages_` — stage rows are a different
 * granularity of the same nights and are deliberately not read (the per-sleep
 * row already carries the night's minutes).
 */
const FILE_KINDS = [
  { key: "dailyRestingHeartRate", pattern: /(^|\/)daily_resting_heart_rate\.csv$/, read: (text) => parseKeyedCsv(text).map(asDailyRestingHeartRate) },
  { key: "restingHeartRateMonthly", pattern: /(^|\/)resting_heart_rate-\d{4}-\d{2}-\d{2}\.json$/, read: (text) => JSON.parse(text) },
  { key: "steps", pattern: /(^|\/)steps_\d{4}-\d{2}-\d{2}\.csv$/, read: (text) => parseKeyedCsv(text).map(asSteps) },
  { key: "exercises", pattern: /(^|\/)UserExercises[^/]*\.csv$/, read: (text) => parseKeyedCsv(text).map(asExercise) },
  { key: "sleeps", pattern: /(^|\/)UserSleeps_[^/]*\.csv$/, read: (text) => parseKeyedCsv(text).map(asSleep) },
  { key: "sleepScores", pattern: /(^|\/)sleep_score\.csv$/, read: (text) => parseKeyedCsv(text).map(asSleepScore) },
  { key: "stressScores", pattern: /(^|\/)Stress Score\.csv$/, read: (text) => parseKeyedCsv(text).map(asStressScore) }
];

/**
 * Split a Google Health Takeout export into typed rows, vendor field names
 * intact. The result is what `schemas/sources/google-health.export.json`
 * contracts and what ./normalize.js consumes.
 *
 * @param {Record<string, string>} files path → file text (CSV or JSON).
 *   Files that are not one of the seven evidence-bearing kinds are ignored,
 *   exactly as the ~20 social/account folders of a real export are.
 */
export function parseGoogleHealthExport(files = {}) {
  const parts = {
    dailyRestingHeartRate: [],
    restingHeartRateMonthly: [],
    steps: [],
    exercises: [],
    sleeps: [],
    sleepScores: [],
    stressScores: []
  };

  for (const [path, text] of Object.entries(files)) {
    const kind = FILE_KINDS.find((candidate) => candidate.pattern.test(path));
    if (kind) parts[kind.key].push(...kind.read(text));
  }

  return parts;
}
