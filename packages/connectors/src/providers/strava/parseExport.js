import { readFile } from "node:fs/promises";
import path from "node:path";

import { VENDOR_SCHEMAS } from "../../../../evidence/src/schemaRegistry.js";
import { readStravaFitOffset, formatUtcOffset } from "./parseFit.js";

/**
 * Strava's bulk data export ("Download Request") — the no-OAuth route by which
 * an athlete hands over history without granting standing access.
 *
 * The archive is ~45 CSVs, of which four carry evidence. The dialect's traps
 * are documented once, in `VENDOR_SCHEMAS.strava_export.quirks`; this file is
 * what enforces them. Two are load-bearing enough to restate:
 *
 * 1. `activities.csv` repeats five header names with *different units* — the
 *    leading display block is localized (`Distance` = 5.67 km) and the raw
 *    metric block is not (`Distance` = 5671.4 m). So every column below is
 *    addressed by index, and the header row is verified on the way in. If
 *    Strava reshuffles the layout we fail loudly rather than return kilometres
 *    labelled as metres.
 *
 * 2. `Activity Date` is UTC and the CSV carries no offset anywhere. We surface
 *    it as an explicit `Z` instant and never guess a calendar day from it. The
 *    offset is recoverable, but only from the matching `.fit.gz` — pass
 *    `readLocalTimezone` to go and get it.
 */

// --- CSV ------------------------------------------------------------------

/**
 * RFC4180-ish reader. Strava quotes any field containing a comma (activity
 * names, dates) and escapes embedded quotes by doubling them.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.length > 1 || (entry[0] ?? "") !== "");
}

/** Header-keyed reader, for the export's unambiguous single-row files. */
function parseKeyedCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

// --- value coercion -------------------------------------------------------

const blank = (value) => value === undefined || value === null || String(value).trim() === "";

/** Empty cells mean "Strava had nothing here", which is not the same as zero. */
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

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

/**
 * "Jul 26, 2026, 1:45:16 AM" -> "2026-07-26T01:45:16Z".
 *
 * Parsed by hand on purpose: `new Date()` reads this string in the *host's*
 * local zone, which would shift a Taipei athlete's export by the server's
 * offset. The value is UTC — verified against the matching FIT file, whose
 * `activity.timestamp` is identical and whose `local_timestamp` sits +8h away.
 *
 * @param {string} value
 * @returns {string|null} ISO 8601 instant, or null when unparseable
 */
export function stravaExportDateToIso(value) {
  if (blank(value)) return null;
  const match = String(value)
    .trim()
    .match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/);
  if (!match) return null;

  const [, monthName, day, year, rawHour, minute, second, meridiem] = match;
  const month = MONTHS[monthName];
  if (month === undefined) return null;

  let hour = Number(rawHour) % 12;
  if (meridiem === "PM") hour += 12;

  const instant = Date.UTC(Number(year), month, Number(day), hour, Number(minute), Number(second));
  return Number.isNaN(instant) ? null : new Date(instant).toISOString().replace(".000Z", "Z");
}

// --- activities.csv -------------------------------------------------------

/**
 * Column index -> [field, expected header]. Indices, not names: five header
 * names appear twice with different units and the duplicates are noted inline.
 */
const ACTIVITY_COLUMNS = {
  0: ["activityId", "Activity ID"],
  1: ["activityDateUtcRaw", "Activity Date"],
  2: ["name", "Activity Name"],
  3: ["activityType", "Activity Type"],
  4: ["description", "Activity Description"],
  11: ["gear", "Activity Gear"],
  12: ["filename", "Filename"],
  // 5 is the same field in display form; 15 is the metric block.
  15: ["elapsedSeconds", "Elapsed Time"],
  16: ["movingSeconds", "Moving Time"],
  // 6 is kilometres or miles per measurementPreference; 17 is always metres.
  17: ["distanceMeters", "Distance"],
  19: ["averageSpeedMetersPerSecond", "Average Speed"],
  20: ["elevationGainMeters", "Elevation Gain"],
  29: ["averageCadence", "Average Cadence"],
  // 7 duplicates this one.
  30: ["maxHeartRate", "Max Heart Rate"],
  31: ["averageHeartRate", "Average Heart Rate"],
  33: ["averageWatts", "Average Watts"],
  34: ["calories", "Calories"],
  // 8 duplicates this one.
  37: ["relativeEffort", "Relative Effort"],
  38: ["totalWorkJoules", "Total Work"],
  43: ["perceivedExertion", "Perceived Exertion"],
  46: ["weightedAveragePower", "Weighted Average Power"],
  // 9 is the string form ("false"); 50 is the numeric form (0.0).
  50: ["commute", "Commute"],
  51: ["totalWeightLiftedKg", "Total Weight Lifted"],
  85: ["activitySteps", "Total Steps"],
  87: ["poolLengthMeters", "Pool Length"],
  88: ["trainingLoad", "Training Load"],
  89: ["intensityFactor", "Intensity"],
  100: ["totalSets", "Total Sets"],
  101: ["totalReps", "Total Reps"]
};

const NUMERIC_FIELDS = new Set([
  "elapsedSeconds", "movingSeconds", "distanceMeters", "averageSpeedMetersPerSecond",
  "elevationGainMeters", "averageCadence", "maxHeartRate", "averageHeartRate",
  "averageWatts", "calories", "relativeEffort", "totalWorkJoules", "perceivedExertion",
  "weightedAveragePower", "totalWeightLiftedKg", "activitySteps", "poolLengthMeters",
  "trainingLoad", "intensityFactor", "totalSets", "totalReps"
]);

/**
 * Verify the header row still says what the column map assumes. A silent
 * column shift is the one failure mode of positional parsing, so it is the one
 * thing checked before any value is read.
 *
 * @param {string[]} header
 */
function assertActivityHeader(header) {
  for (const [index, [field, expected]] of Object.entries(ACTIVITY_COLUMNS)) {
    const actual = (header[index] ?? "").trim();
    if (actual !== expected) {
      throw new Error(
        `Strava export layout changed: column ${index} should be "${expected}" (${field}) but reads "${actual}". ` +
          "Re-derive the column map before trusting any value in this file."
      );
    }
  }
}

/**
 * @typedef {Object} StravaExportActivity
 * @property {string} activityId
 * @property {string|null} startedAtUtc  ISO instant; UTC, offset unknown
 * @property {boolean} timezoneKnown     always false — see `quirks`
 * @property {string|null} activityType
 * @property {number|null} movingSeconds
 * @property {number|null} relativeEffort
 * @property {number|null} trainingLoad
 */

/**
 * @param {string} text contents of `activities.csv`
 * @returns {StravaExportActivity[]}
 */
export function parseStravaActivitiesCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [header, ...body] = rows;
  assertActivityHeader(header);

  return body.map((cells) => {
    const activity = {};

    for (const [index, [field]] of Object.entries(ACTIVITY_COLUMNS)) {
      const raw = cells[index];
      if (field === "commute") activity[field] = bool(raw);
      else if (NUMERIC_FIELDS.has(field)) activity[field] = num(raw);
      else activity[field] = str(raw);
    }

    activity.startedAtUtc = stravaExportDateToIso(activity.activityDateUtcRaw);
    // Stated, not implied: nothing in this CSV says where the athlete was, so
    // no consumer may infer a calendar day from `startedAtUtc` alone.
    activity.timezoneKnown = false;
    // The upload id, kept separate from `activityId` because they differ.
    activity.uploadId = activity.filename
      ? path.basename(activity.filename).replace(/\.(fit|tcx|gpx)(\.gz)?$/i, "")
      : null;

    return activity;
  });
}

// --- general_preferences.csv ---------------------------------------------

/** "72.0 kg" / "240 W" -> 72 / 240. */
function measure(value) {
  if (blank(value)) return null;
  const match = String(value).trim().match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** "Mar 12, 1988" -> "1988-03-12". */
function birthDateToIsoDay(value) {
  if (blank(value)) return null;
  const match = String(value).trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1]];
  if (month === undefined) return null;
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

/**
 * The athlete thresholds the load columns are expressed against.
 *
 * `Maximum Heartrate` is reported alongside `maxHeartRateIsAgeEstimate`,
 * because Strava seeds it with 220 - age and most athletes never edit it. The
 * flag is what lets a decision say its Relative Effort rests on an estimate.
 *
 * `220 - age` appears below only to recognise that seeded default — nothing
 * here derives a heart rate from it. Sources, because the number is quoted at
 * users and has to be answerable:
 *
 *   - Origin: Fox, Naughton & Haskell (1971). Not derived from a study; a rule
 *     of thumb drawn from 11 small, largely unpublished data sets.
 *   - Revision: Tanaka, Monahan & Seals, "Age-predicted maximal heart rate
 *     revisited", J Am Coll Cardiol 2001;37(1):153-6 (PMID 11153730). A
 *     meta-analysis of 351 studies / 18,712 subjects giving 208 - 0.7 x age,
 *     and finding 220 - age systematically underestimates older adults.
 *     Individual error runs to 10-20 bpm either way.
 *
 * So a matched value means "Strava's default, which is an industry convention
 * with a wide error bar", not "this athlete's maximum". That distinction is
 * the whole reason the flag exists.
 *
 * @param {string} text contents of `general_preferences.csv`
 * @param {{ asOf?: Date }} [options]
 */
export function parseStravaPreferencesCsv(text, options = {}) {
  const [row] = parseKeyedCsv(text);
  if (!row) return null;

  const dateOfBirth = birthDateToIsoDay(row["Date of Birth"]);
  const maxHeartRateBpm = measure(row["Maximum Heartrate"]);
  const asOf = options.asOf ?? new Date();

  let maxHeartRateIsAgeEstimate = null;
  if (maxHeartRateBpm !== null && dateOfBirth) {
    const age = asOf.getUTCFullYear() - Number(dateOfBirth.slice(0, 4));
    maxHeartRateIsAgeEstimate = maxHeartRateBpm === 220 - age;
  }

  return {
    functionalThresholdPowerWatts: measure(row["Functional Threshold Power"]),
    maxHeartRateBpm,
    maxHeartRateIsAgeEstimate,
    dateOfBirth,
    weightKg: measure(row.Weight),
    athleteType: str(row["Athlete Type"]),
    // Without this, the export's leading distance/elevation columns have no unit.
    measurementPreference: str(row["Measurement Preference"])
  };
}

// --- structured_details.csv ----------------------------------------------

/**
 * Per-set strength data — the only file in the export that reaches exercise
 * level. Frequently empty (Strava only fills it for logged strength sessions),
 * so an empty list here is a real answer, not a parse failure.
 *
 * @param {string} text contents of `structured_details.csv`
 */
export function parseStravaStructuredDetailsCsv(text) {
  return parseKeyedCsv(text).map((row) => ({
    activityId: str(row["Activity ID"]),
    exerciseName: str(row["Exercise Name"]),
    repetitions: num(row.Repetitions),
    durationSeconds: num(row["Duration (seconds)"]),
    weightKg: num(row.Weight),
    startOffsetMs: num(row["Start Time (milliseconds)"]),
    supersetId: str(row["Superset ID"]),
    rpe: num(row["Rate of Perceived Exertion"])
  }));
}

// --- archive --------------------------------------------------------------

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Recover each activity's UTC offset from its FIT file.
 *
 * The CSV cannot answer which training day a session belongs to; the FIT file
 * can, and it is the only thing read out of it. Activities whose FIT file is
 * absent or undecodable keep `timezoneKnown: false` — a partial answer is the
 * honest one, and it is per-activity because an athlete who travels has
 * genuinely different offsets across their history.
 *
 * @param {StravaExportActivity[]} activities
 * @param {string} directory export root
 * @param {{ concurrency?: number }} [options]
 */
export async function attachLocalOffsets(activities, directory, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const queue = [...activities];

  const worker = async () => {
    while (queue.length > 0) {
      const activity = queue.shift();
      if (!activity?.filename) continue;

      const offset = await readStravaFitOffset(path.join(directory, activity.filename));
      if (!offset) continue;

      activity.utcOffsetSeconds = offset.utcOffsetSeconds;
      activity.utcOffset = formatUtcOffset(offset.utcOffsetSeconds);
      activity.startedAtLocalWallClock = offset.startedAtLocalWallClock;
      // The offset is a fact about this activity, not a timezone name: a fixed
      // +08:00 is all a FIT file can prove, and it is all that is claimed.
      activity.startedAtLocal = `${offset.startedAtLocalWallClock}${activity.utcOffset}`;
      activity.timezoneKnown = true;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return activities;
}

/**
 * Read an unpacked Strava export directory.
 *
 * Only the four evidence-bearing files are opened; the rest of the archive is
 * social and account data this system has no reason to read. `activities.csv`
 * is required, everything else is optional and reported as absent rather than
 * defaulted.
 *
 * `readLocalTimezone` is opt-in because it opens one FIT file per activity —
 * cheap for a season, not free for a decade of history. Without it every
 * activity stays `timezoneKnown: false` and the caller supplies the timezone.
 *
 * @param {string} directory
 * @param {{ asOf?: Date, readLocalTimezone?: boolean, concurrency?: number }} [options]
 * @returns {Promise<{ activities: StravaExportActivity[], anchors: object|null, structuredSets: object[], files: Record<string, boolean> }>}
 */
export async function parseStravaExport(directory, options = {}) {
  const activitiesCsv = await readOptional(path.join(directory, "activities.csv"));
  if (activitiesCsv === null) {
    throw new Error(`Not a Strava export: ${path.join(directory, "activities.csv")} is missing.`);
  }

  const preferencesCsv = await readOptional(path.join(directory, "general_preferences.csv"));
  const structuredCsv = await readOptional(path.join(directory, "structured_details.csv"));

  const activities = parseStravaActivitiesCsv(activitiesCsv);
  if (options.readLocalTimezone) {
    await attachLocalOffsets(activities, directory, options);
  }

  return {
    activities,
    anchors: preferencesCsv ? parseStravaPreferencesCsv(preferencesCsv, options) : null,
    structuredSets: structuredCsv ? parseStravaStructuredDetailsCsv(structuredCsv) : [],
    files: {
      "activities.csv": true,
      "general_preferences.csv": preferencesCsv !== null,
      "structured_details.csv": structuredCsv !== null
    }
  };
}

/** The dialect this parser implements, for callers that want to explain it. */
export const STRAVA_EXPORT_SCHEMA = VENDOR_SCHEMAS.strava_export;
