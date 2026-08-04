// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Google Health Takeout source-schema simulation scenarios.
 *
 * Same charter as ./garmin.js: these train and verify **schema comprehension**
 * — the Semantic Fitness Layer's ability to read this dialect and land it in
 * the canonical vocabulary. They are not a tuning set; the values carried
 * through are freight, not ground truth, and no check asserts what anyone's
 * readiness ought to be.
 *
 * The axis of variation is the *shape of the export*:
 *
 *   complete_export      every file kind with data, Fitbit composites included
 *   sentinels_and_gaps   0.0 heart rates, CALCULATION_FAILED stress, no sleep rows
 *   dialect_equivalence  daily resting HR spelled as CSV vs month-sliced JSON
 *   lossy_export         the Garmin-synced reality: composites are header-only
 *   sparse_wear          the wearable records every third day; the phone stays
 *
 * Only the renderer at the bottom knows the dialect's spelling: local-midnight
 * timestamps expressed in UTC, MM/DD/YY JSON dates, dual-recorder step rows,
 * 46-column exercise CSVs with 0/UNSPECIFIED sentinels.
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const OFFSET_HOURS = 8; // the export is lived in +08:00; rows carry it per the dialect

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** An ordinary session. kcal = load × 10 so both load routes land on the same number. */
function session(load, { name = "Outdoor Run" } = {}) {
  const minutes = Math.max(20, Math.round(load / 1.7));
  return {
    name,
    minutes,
    kcal: load * 10,
    cardioLoad: load,
    distanceMm: minutes * 168000,
    avgHr: 138,
    peakHr: 157
  };
}

const week = (pattern) => (daysAgo) => pattern[daysAgo % 7];
const BASE_WEEK = week([0, 58, 0, 46, 0, 74, 0]);

/** A fully instrumented day: every file kind this dialect can populate. */
function completeDay(daysAgo) {
  const load = BASE_WEEK(daysAgo);
  return {
    load,
    activity: load > 0 ? session(load) : null,
    sleep: { minutes: 450, score: 82 },
    restingHr: 54,
    stress: 30,
    steps: { garmin: [3200, 3200, 3200], phone: [2100, 2200, 2100] }
  };
}

const PROFILE = { timezone: "UTC", fitnessLevel: "intermediate" };
const GOALS = [{ type: "half_marathon", label: "Half marathon", priority: 1 }];
const CONSTRAINTS = { availableMinutes: 60 };

const SCHEDULED_SESSION = {
  focus: "Tempo Run",
  type: "run",
  durationMinutes: 50,
  intensity: "high",
  targetMuscleGroups: ["legs"],
  exercises: ["Tempo Run", "Strides"]
};

// ---- shared checks --------------------------------------------------------

const speaksCanonicalVocabulary = {
  name: "every emitted signal is canonical, platform-labelled, and correctly united",
  run: ({ evidence, canonicalSignals }) => {
    const problems = [];
    for (const metric of evidence.healthMetrics) {
      const spec = canonicalSignals[metric.type];
      if (!spec) problems.push(`unknown signal ${metric.type}`);
      else if (metric.unit !== spec.unit) problems.push(`${metric.type} arrived as ${metric.unit}, registry says ${spec.unit}`);
      if (metric.source !== "google_health_connect") problems.push(`${metric.type} lost its source label (${metric.source})`);
    }
    for (const workout of evidence.workouts) {
      if (workout.source !== "google_health_connect") problems.push(`workout ${workout.id} lost its source label`);
    }
    return problems.length === 0 || problems.slice(0, 3).join("; ");
  }
};

const decisionRemainsSelfExplaining = {
  name: "a decision still lands and explains itself on this shape",
  run: ({ decision }) => {
    if (!["keep", "adjust", "substitute", "defer", "advance"].includes(decision.decision.type)) {
      return `decision type was ${decision.decision.type}`;
    }
    if (decision.reason.length === 0) return "no reason was given";
    if (decision.evidence.length === 0) return "no evidence was cited";
    if (!["low", "medium", "high"].includes(decision.confidence)) return `confidence was ${decision.confidence}`;
    return true;
  }
};

/** The Takeout export contains an HRV folder of READMEs and no HRV data at all. */
const hrvIsNeverInvented = {
  name: "hrv is reported missing — this dialect ships no HRV series whatsoever",
  run: ({ state, evidence }) => {
    if (evidence.healthMetrics.some((metric) => metric.type === "hrv_ms")) {
      return "an hrv_ms reading was manufactured from an export that has none";
    }
    return state.signalCoverage.recovery.missing.includes("hrv") || "hrv was not reported as missing";
  }
};

/** Quirk `stepsArriveFromTwoRecordersAtOnce`, asserted end to end. */
const stepsAreNeverDoubleCounted = {
  name: "dual-recorder step days count the best recorder, never the sum of both",
  run: ({ evidence, rawExport }) => {
    const bestBySum = new Map();
    for (const row of rawExport.steps) {
      if (!row.steps) continue;
      const day = new Date(Date.parse(row.timestamp) + OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10);
      const perSource = bestBySum.get(day) ?? new Map();
      perSource.set(row["data source"], (perSource.get(row["data source"]) ?? 0) + row.steps);
      bestBySum.set(day, perSource);
    }
    for (const metric of evidence.healthMetrics.filter((entry) => entry.type === "steps")) {
      const perSource = bestBySum.get(metric.recordedAt.slice(0, 10));
      if (!perSource) return `a steps day appeared that the export never contained (${metric.recordedAt})`;
      const sums = [...perSource.values()];
      const best = Math.max(...sums);
      const total = sums.reduce((sum, value) => sum + value, 0);
      if (metric.value !== best) {
        return metric.value === total
          ? `${metric.recordedAt.slice(0, 10)} was double-counted: ${total} (sum of recorders) instead of ${best}`
          : `${metric.recordedAt.slice(0, 10)} was ${metric.value}, expected the best recorder's ${best}`;
      }
    }
    return true;
  }
};

// ---- the scenarios --------------------------------------------------------

export const GOOGLE_HEALTH_SCENARIOS = [
  {
    id: "complete_export",
    label: "Complete export — every file kind with data",
    purpose:
      "The reference reading. If the registry declares the Takeout dialect supplies a signal, an export with every file populated must actually produce it — including the Fitbit composites a Fitbit-native user would have.",
    days: 70,
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day: completeDay,
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "every signal the registry declares for the Takeout dialect is actually parsed",
        run: ({ evidence, declaredSignals }) => {
          const produced = new Set([
            ...evidence.healthMetrics.map((metric) => metric.type),
            ...evidence.vendorAssessments.map((assessment) => assessment.type)
          ]);
          const undelivered = declaredSignals.filter((signal) => !produced.has(signal));
          return undelivered.length === 0 || `declared but never parsed: ${undelivered.join(", ")}`;
        }
      },
      {
        name: "units are converted, not passed through (minutes -> hours, start/end -> minutes)",
        run: ({ evidence, rawExport }) => {
          const night = rawExport.sleeps.at(-1);
          const sleep = evidence.healthMetrics.filter((metric) => metric.type === "sleep_duration_hours").at(-1);
          const expectedHours = Number((night.minutes_asleep / 60).toFixed(2));
          if (!sleep) return "no sleep duration was parsed";
          if (sleep.value !== expectedHours) return `${night.minutes_asleep}min became ${sleep.value}h, expected ${expectedHours}h`;

          const exercise = rawExport.exercises.at(-1);
          const workout = evidence.workouts.at(-1);
          const expectedMinutes = Math.round((Date.parse(exercise.exercise_end) - Date.parse(exercise.exercise_start)) / 60000);
          return (
            workout.durationMinutes === expectedMinutes ||
            `${exercise.exercise_start}→${exercise.exercise_end} became ${workout.durationMinutes}min, expected ${expectedMinutes}`
          );
        }
      },
      {
        name: "Fitbit's own Cardio Load is preferred over an energy estimate, and says so",
        run: ({ evidence, rawExport }) => {
          const exercise = rawExport.exercises.at(-1);
          const workout = evidence.workouts.at(-1);
          if (workout.trainingLoad !== Math.round(exercise.tracker_cardio_load)) {
            return `load ${workout.trainingLoad} ignored Fitbit's ${exercise.tracker_cardio_load}`;
          }
          return workout.metadata.loadSource === "fitbit_cardio_load" || `loadSource was ${workout.metadata.loadSource}`;
        }
      },
      {
        name: "local-midnight-in-UTC stamps land on the local day, not the UTC date",
        run: ({ evidence, rawExport }) => {
          const expected = new Set(
            rawExport.dailyRestingHeartRate
              .filter((row) => row["beats per minute"] > 0)
              .map((row) => new Date(Date.parse(row.timestamp) + OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10))
          );
          const parsed = evidence.healthMetrics
            .filter((metric) => metric.type === "resting_hr_bpm")
            .map((metric) => metric.recordedAt.slice(0, 10));
          const misfiled = parsed.filter((day) => !expected.has(day));
          if (misfiled.length > 0) return `resting HR landed on days the export never measured: ${misfiled.slice(0, 2)}`;
          return parsed.length === expected.size || `${expected.size} measured days became ${parsed.length} readings`;
        }
      },
      stepsAreNeverDoubleCounted,
      hrvIsNeverInvented,
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "sentinels_and_gaps",
    label: "Sentinels and gaps — four days the tracker went unworn",
    purpose:
      "This dialect encodes 'not measured' as values: 0.0 beats per minute, a stress row with CALCULATION_FAILED, a sleep file with no row for the night. Reading those literally would turn an unworn tracker into a flatlined, serene, well-rested athlete.",
    days: 70,
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day(daysAgo) {
      const day = completeDay(daysAgo);
      if (daysAgo > 4) return day;
      return {
        ...day,
        restingHr: 0, // written to the CSV as the 0.0 sentinel
        stress: null, // written as a CALCULATION_FAILED row
        sleep: null, // no row at all — the commonest real-world hole
        steps: { phone: day.steps.phone } // the phone keeps counting
      };
    },
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "not-measured sentinels never become physiology",
        run: ({ evidence, asOf }) => {
          const offWristFrom = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 4 * DAY_MS).toISOString();
          const leaked = evidence.healthMetrics.filter(
            (metric) =>
              (metric.type === "resting_hr_bpm" || metric.type === "stress") && metric.recordedAt >= offWristFrom
          );
          if (leaked.length > 0) return `${leaked[0].type}=${leaked[0].value} was read as a measurement`;
          const zeros = evidence.healthMetrics.filter((metric) => metric.value <= 0);
          return zeros.length === 0 || `a zero sentinel survived as ${zeros[0].type}`;
        }
      },
      {
        name: "the nights that were never recorded are reported as missing sleep",
        run: ({ state }) =>
          state.signalCoverage.recovery.missing.includes("sleep") ||
          `missing was ${state.signalCoverage.recovery.missing.join(", ")}`
      },
      {
        name: "what the phone can still supply off-wrist is read instead of giving up",
        run: ({ evidence, asOf }) => {
          const offWristFrom = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 4 * DAY_MS).toISOString();
          const stillCounted = evidence.healthMetrics.some(
            (metric) => metric.type === "steps" && metric.recordedAt >= offWristFrom
          );
          return stillCounted || "phone-recorded steps vanished with the wearable";
        }
      },
      stepsAreNeverDoubleCounted,
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "dialect_equivalence",
    label: "Dialect equivalence — daily resting HR written two ways",
    purpose:
      "The same daily resting-heart-rate fact ships twice in one export: as an ISO-instant CSV row stamped at local midnight, and as a month-sliced JSON entry dated 04/06/26. Different spellings of the same physiological fact must normalize to identical canonical evidence — that identity is what makes the layer a translation and not a per-format special case.",
    days: 70,
    dialects: ["csv", "monthly_json"],
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day: completeDay,
    checks: [speaksCanonicalVocabulary, decisionRemainsSelfExplaining]
  },

  {
    id: "lossy_export",
    label: "Lossy export — the Garmin-synced reality",
    purpose:
      "Measured over one real 480-file export whose values arrived by Garmin sync: sleep_score.csv and Stress Score.csv are header-only, tracker_cardio_load is 0 on every session, and session heart rates are 0. The layer must degrade by narrowing what it claims — load falls back to measured energy and says so — never by filling a hole with a plausible number.",
    days: 70,
    dialect: "lossy",
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day: completeDay,
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "a session without Fitbit's load is still usable, and labelled as energy-derived",
        run: ({ evidence }) => {
          const workout = evidence.workouts.at(-1);
          if (!workout) return "no workout was parsed";
          if (workout.metadata.loadSource !== "active_energy") {
            return `loadSource was ${workout.metadata.loadSource}`;
          }
          return workout.trainingLoad > 0 || "the energy route produced no load at all";
        }
      },
      {
        name: "a night timed by UserSleeps yields duration only, never an invented quality",
        run: ({ evidence }) => {
          const hasDuration = evidence.healthMetrics.some((metric) => metric.type === "sleep_duration_hours");
          const hasQuality = evidence.healthMetrics.some((metric) => metric.type === "sleep_quality");
          if (!hasDuration) return "the timed nights were dropped entirely";
          return !hasQuality || "a sleep quality score appeared from a header-only sleep_score.csv";
        }
      },
      {
        name: "0-bpm session heart rates are reported absent, not athletic",
        run: ({ evidence }) => {
          const withHr = evidence.workouts.filter((workout) => workout.metadata.avgHr !== null || workout.metadata.maxHr !== null);
          return withHr.length === 0 || `${withHr[0].id} read a 0 sentinel as a heart rate`;
        }
      },
      hrvIsNeverInvented,
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "sparse_wear",
    label: "Sparse wear — the wearable records every third day, the phone stays",
    purpose:
      "The observed export covered resting HR on 47 of 120 days. With wearable records only every third day the layer must let the coverage report shrink honestly rather than carrying an old reading forward — while still counting the steps the phone kept recording.",
    days: 70,
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day(daysAgo) {
      const day = completeDay(daysAgo);
      if (daysAgo % 3 === 2) return day;
      return { ...day, restingHr: 0, sleep: null, stress: null, steps: { phone: day.steps.phone } };
    },
    checks: [
      speaksCanonicalVocabulary,
      hrvIsNeverInvented,
      {
        name: "no reading is fabricated for a day the export has no record for",
        run: ({ evidence, rawExport }) => {
          const recorded = new Set(
            rawExport.dailyRestingHeartRate
              .filter((row) => row["beats per minute"] > 0)
              .map((row) => new Date(Date.parse(row.timestamp) + OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 10))
          );
          const parsed = new Set(
            evidence.healthMetrics
              .filter((metric) => metric.type === "resting_hr_bpm")
              .map((metric) => metric.recordedAt.slice(0, 10))
          );
          const invented = [...parsed].filter((day) => !recorded.has(day));
          const dropped = [...recorded].filter((day) => !parsed.has(day));
          if (invented.length > 0) return `readings appeared for unmeasured days: ${invented.slice(0, 2)}`;
          return dropped.length === 0 || `measured days were lost in normalization: ${dropped.slice(0, 2)}`;
        }
      },
      {
        name: "a sparse export still yields canonical signals rather than nothing",
        run: ({ state, evidence }) => {
          if (evidence.healthMetrics.length === 0) return "a sparse but real export produced no canonical signals";
          return (
            state.signalCoverage.recovery.usable.length > 0 ||
            "nothing at all was usable from a sparse but real export"
          );
        }
      },
      decisionRemainsSelfExplaining
    ]
  }
];

// ---- rendering into the Takeout dialect -----------------------------------

const DIALECTS = {
  /** Daily resting HR spelled as the ISO-instant CSV. */
  csv: { restingHrSpelling: "csv", hollowComposites: false, omitCardioLoad: false, omitSessionHr: false },
  /** The same facts, resting HR spelled as month-sliced MM/DD/YY JSON. */
  monthly_json: { restingHrSpelling: "monthly_json", hollowComposites: false, omitCardioLoad: false, omitSessionHr: false },
  /** The Garmin-synced reality: composites hollow, session extras zeroed. */
  lossy: { restingHrSpelling: "csv", hollowComposites: true, omitCardioLoad: true, omitSessionHr: true }
};

export const GOOGLE_HEALTH_DIALECTS = Object.keys(DIALECTS);

const csv = (header, rows) => [header, ...rows].join("\n") + "\n";
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const localMidnightUtc = (day) => iso(Date.parse(`${day}T00:00:00Z`) - OFFSET_HOURS * HOUR_MS);
const mmddyy = (day) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(2, 4)} 00:00:00`;

const EXERCISE_HEADER =
  "exercise_id,exercise_start,exercise_end,utc_offset,exercise_created,exercise_last_updated,activity_name,log_type,pool_length,pool_length_unit,intervals,distance_units,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_total_altitude_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,tracker_avg_pace_mm_per_second,tracker_avg_speed_mm_per_second,tracker_peak_speed_mm_per_second,tracker_auto_stride_run_mm,tracker_auto_stride_walk_mm,tracker_swim_lengths,tracker_pool_length,tracker_pool_length_unit,tracker_cardio_load,manually_logged_total_calories,manually_logged_total_steps,manually_logged_total_distance_mm,manually_logged_pool_length,manually_logged_pool_length_unit,events,activity_type_probabilities,autodetected_confirmed,autodetected_start_timestamp,autodetected_end_timestamp,autodetected_utc_offset,autodetected_activity_name,autodetected_sensor_based_activity_name,deletion_reason,activity_label,suggested_start_timestamp,suggested_end_timestamp,reconciliation_status,location_metadata";

const SLEEP_HEADER =
  "sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source,algorithm_version,sleep_created,sleep_last_updated";

const SLEEP_SCORE_HEADER =
  "sleep_log_entry_id,timestamp,overall_score,composition_score,revitalization_score,duration_score,deep_sleep_in_minutes,resting_heart_rate,restlessness";

const STRESS_HEADER =
  "DATE,UPDATED_AT,STRESS_SCORE,SLEEP_POINTS,MAX_SLEEP_POINTS,RESPONSIVENESS_POINTS,MAX_RESPONSIVENESS_POINTS,EXERTION_POINTS,MAX_EXERTION_POINTS,STATUS,CALCULATION_FAILED";

/**
 * Render a scenario as a Google Health Takeout file bundle (path → text).
 *
 * Only this function knows the dialect's spellings. A scenario that says "the
 * tracker went unworn" becomes a `0.0` CSV cell and a CALCULATION_FAILED row
 * here — so the reader is exercised against the same awkward shapes a real
 * export contains, rather than a tidied-up one.
 *
 * @param {object} scenario one of GOOGLE_HEALTH_SCENARIOS
 * @param {{ asOf: string, dialect?: string }} options
 */
export function buildGoogleHealthTakeout(scenario, { asOf, dialect } = {}) {
  const spelling = DIALECTS[dialect || scenario.dialect || "csv"];
  if (!spelling) throw new Error(`Unknown Google Health dialect: ${dialect}`);

  const days = [];
  for (let daysAgo = scenario.days - 1; daysAgo >= 0; daysAgo -= 1) {
    days.push({ daysAgo, date: shiftDay(asOf, daysAgo), ...scenario.day(daysAgo) });
  }

  const restingHrCsv = [];
  const restingHrJson = [];
  const stepRows = [];
  const sleepRows = [];
  const sleepScoreRows = [];
  const stressRows = [];
  const exerciseRows = [];

  days.forEach((day, index) => {
    // Quirk `midnightTimestampsEncodeTheOffset` / `monthlyJsonDatesAreMMDDYY`:
    // both spellings of the same daily fact, one of which is rendered.
    if (spelling.restingHrSpelling === "csv") {
      restingHrCsv.push(`${localMidnightUtc(day.date)},${(day.restingHr ?? 0).toFixed(1)},Garmin Connect™ Health Kit`);
    } else if (day.restingHr !== undefined) {
      restingHrJson.push({
        dateTime: mmddyy(day.date),
        value: { date: null, value: Number((day.restingHr ?? 0).toFixed(1)), error: 0.0 }
      });
    }

    // Quirk `stepsArriveFromTwoRecordersAtOnce`: interleaved recorders, real
    // UTC instants inside the local day (+08:00 → hours 01–15 UTC).
    for (const [recorder, label] of [
      ["garmin", "Garmin Connect™ Health Kit"],
      ["phone", "Phone Health Kit"]
    ]) {
      (day.steps?.[recorder] ?? []).forEach((count, slot) => {
        stepRows.push(`${day.date}T0${1 + slot * 4}:00:00Z,${count},${label}`);
      });
    }

    if (day.sleep) {
      // The night ends 06:30 local on `date` — 22:30Z the previous UTC day.
      const wake = Date.parse(`${day.date}T06:30:00Z`) - OFFSET_HOURS * HOUR_MS;
      const start = wake - (day.sleep.minutes + 30) * 60000;
      sleepRows.push(
        `${170000000000000000n + BigInt(index)},STAGES,${day.sleep.minutes + 30},0,0,${day.sleep.minutes},30,0,0,+08:00,${iso(start)},+08:00,${iso(wake)},UNKNOWN,none,${iso(wake + 30 * 60000)},${iso(wake + 30 * 60000)}`
      );
      if (!spelling.hollowComposites && day.sleep.score) {
        sleepScoreRows.push(
          `${170000000000000000n + BigInt(index)},${iso(wake + 5 * 60000)},${day.sleep.score},20,18,44,66,0,0.04`
        );
      }
    }

    if (!spelling.hollowComposites) {
      // A day the tracker measured gets a READY row; an unmeasured day gets the
      // CALCULATION_FAILED sentinel row a real file carries.
      stressRows.push(
        day.stress != null
          ? `${day.date},${day.date}T06:00:00Z,${day.stress},25,30,27,30,26,40,READY,False`
          : `${day.date},${day.date}T06:00:00Z,0,0,30,0,30,0,40,NOT_READY,True`
      );
    }

    if (day.activity) {
      const activity = day.activity;
      const start = Date.parse(`${day.date}T09:00:00Z`); // 17:00 local
      const end = start + activity.minutes * 60000;
      const hr = spelling.omitSessionHr ? 0 : activity.avgHr;
      const peak = spelling.omitSessionHr ? 0 : activity.peakHr;
      const cardio = spelling.omitCardioLoad ? 0 : activity.cardioLoad;
      exerciseRows.push(
        `${100000000000000000n + BigInt(index)},${iso(start)},${iso(end)},+08:00,${iso(end)},${iso(end)},${activity.name},MANUAL,0,UNSPECIFIED,,UNSPECIFIED,${activity.kcal},0,${activity.distanceMm},0,${hr},${peak},0,0,0,0,0,0,0,UNSPECIFIED,${cardio},,,,,,,,,,,,,,UNSPECIFIED,,,,,`
      );
    }
  });

  const files = {
    "Physical Activity_GoogleData/steps_2026-05-01.csv": csv("timestamp,steps,data source", stepRows),
    "Health Fitness Data_GoogleData/UserExercises_2026-04-07.csv": csv(EXERCISE_HEADER, exerciseRows),
    "Health Fitness Data_GoogleData/UserSleeps_2026-04-07.csv": csv(SLEEP_HEADER, sleepRows),
    // Hollow composites render as the header-only files a real Garmin-synced
    // export contains — present but empty, exactly the shape observed.
    "Sleep Score/sleep_score.csv": csv(SLEEP_SCORE_HEADER, spelling.hollowComposites ? [] : sleepScoreRows),
    "Stress Score/Stress Score.csv": csv(STRESS_HEADER, stressRows)
  };

  if (spelling.restingHrSpelling === "csv") {
    files["Physical Activity_GoogleData/daily_resting_heart_rate.csv"] = csv(
      "timestamp,beats per minute,data source",
      restingHrCsv
    );
  } else {
    files["Global Export Data/resting_heart_rate-2026-07-05.json"] = JSON.stringify(restingHrJson, null, 2);
  }

  return files;
}
