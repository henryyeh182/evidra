// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Apple Health source-schema simulation scenarios.
 *
 * Like the Garmin and Google Health sets, these exist to verify **schema
 * comprehension** — reading Apple's dialect and landing it in the canonical
 * vocabulary — not to tune anything. No check asserts what a readiness score
 * ought to be, and the physiological values carried through are freight rather
 * than ground truth.
 *
 * The axis of variation is the shape of the export:
 *
 *   complete_export       energy and distance where a current export puts them
 *   legacy_dialect        the same day with energy on the <Workout> tag instead
 *   sentinels_and_gaps    ActiveEnergyBurned sum="0", no sleep, no HRV
 *   multi_recorder_steps  one day counted by phone, watch and a synced Garmin
 *   sparse_wear           steps most days, recovery signals almost never
 *
 * Two of these are here because a real export said so. `legacy_dialect` guards
 * the failure that made every one of 228 real workouts report no training load:
 * the connector read `totalEnergyBurned` off the tag, and a current export puts
 * energy in a nested <WorkoutStatistics> instead. Both must now normalize
 * identically. `sparse_wear` is the shape of a phone-first export — steps across
 * 2,708 days, HRV across 7 — where the honest output is coverage saying so.
 */

const DAY_MS = 86400000;

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** Apple's date spelling: "2026-07-20 08:30:00 +0800". */
const appleDate = (day, clock = "08:30:00") => `${day} ${clock} +0800`;

const attrs = (pairs) =>
  Object.entries(pairs)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");

const record = (pairs) => `  <Record ${attrs(pairs)}/>`;

/**
 * A workout in whichever dialect the scenario is exercising.
 *
 * `statistics` is what a current export writes; `onTag` is what an older one
 * wrote. The rest of the tag is identical, which is the whole point of the
 * equivalence check.
 */
function workout({ day, type, minutes, kcal = null, km = null, dialect = "statistics", sourceName = "Watch" }) {
  const start = appleDate(day, "18:00:00");
  const end = appleDate(day, "18:45:00");
  const onTag = dialect === "on_tag";

  const head = `  <Workout ${attrs({
    workoutActivityType: type,
    duration: minutes,
    durationUnit: "min",
    sourceName,
    startDate: start,
    endDate: end,
    totalEnergyBurned: onTag ? kcal : null,
    totalDistance: onTag && km !== null ? km : null
  })}>`;

  const children = [];
  if (!onTag && kcal !== null) {
    children.push(
      `    <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="${start}" endDate="${end}" sum="${kcal}" unit="Cal"/>`
    );
  }
  if (!onTag && km !== null) {
    children.push(
      `    <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="${start}" endDate="${end}" sum="${km}" unit="km"/>`
    );
  }
  // Present in every real export and read by nobody — it belongs here so the
  // parser is exercised against noise it must step over.
  children.push(`    <MetadataEntry key="HKIndoorWorkout" value="1"/>`);

  return [head, ...children, "  </Workout>"].join("\n");
}

const steps = (day, count, sourceName) =>
  record({
    type: "HKQuantityTypeIdentifierStepCount",
    value: count,
    unit: "count",
    sourceName,
    startDate: appleDate(day, "12:00:00"),
    endDate: appleDate(day, "13:00:00")
  });

const restingHr = (day, bpm) =>
  record({
    type: "HKQuantityTypeIdentifierRestingHeartRate",
    value: bpm,
    unit: "count/min",
    sourceName: "Watch",
    startDate: appleDate(day, "07:00:00"),
    endDate: appleDate(day, "07:00:00")
  });

const hrv = (day, ms) =>
  record({
    type: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
    value: ms,
    unit: "ms",
    sourceName: "Watch",
    startDate: appleDate(day, "07:05:00"),
    endDate: appleDate(day, "07:05:00")
  });

/**
 * Sleep arrives as staged intervals, and only the Asleep* stages are sleep.
 *
 * The stages run through the small hours of `day` so that every interval ends
 * on `day` — the connector keys a night by the day it ends on, which is what
 * makes "last night" mean the morning you woke up.
 */
function sleepStages(day, { coreMinutes = 240, remMinutes = 90, deepMinutes = 60, includeInBed = true } = {}) {
  const lines = [];
  let cursor = 0; // minutes past midnight
  const clock = (minutes) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

  const stage = (value, minutes) => {
    const from = cursor;
    cursor += minutes;
    lines.push(
      record({
        type: "HKCategoryTypeIdentifierSleepAnalysis",
        value,
        sourceName: "Watch",
        startDate: appleDate(day, clock(from)),
        endDate: appleDate(day, clock(cursor))
      })
    );
  };

  if (includeInBed) stage("HKCategoryValueSleepAnalysisInBed", 15);
  stage("HKCategoryValueSleepAnalysisAsleepCore", coreMinutes);
  stage("HKCategoryValueSleepAnalysisAsleepREM", remMinutes);
  stage("HKCategoryValueSleepAnalysisAsleepDeep", deepMinutes);
  return lines;
}

function exportXml(lines) {
  return ['<?xml version="1.0" encoding="UTF-8"?>', "<HealthData>", ...lines, "</HealthData>"].join("\n");
}

// --- export shapes ---------------------------------------------------------

function completeExport(asOf, { dialect = "statistics" } = {}) {
  const lines = [];
  for (let daysAgo = 0; daysAgo < 14; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    lines.push(steps(day, 8000 + daysAgo * 10, "iPhone"));
    lines.push(restingHr(day, 54));
    lines.push(hrv(day, 62));
    lines.push(...sleepStages(day));
    if (daysAgo % 2 === 1) {
      lines.push(
        workout({
          day,
          type: "HKWorkoutActivityTypeRunning",
          minutes: 45,
          kcal: 480,
          km: 8.2,
          dialect
        })
      );
    }
  }
  return exportXml(lines);
}

function sentinelExport(asOf) {
  const lines = [];
  for (let daysAgo = 0; daysAgo < 14; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    lines.push(steps(day, 7400, "iPhone"));
    if (daysAgo % 2 === 1) {
      // The shape a third-party writer produces: a statistic that exists and
      // says zero. Zero calories is not a measurement.
      lines.push(
        workout({
          day,
          type: "HKWorkoutActivityTypeTraditionalStrengthTraining",
          minutes: 50,
          kcal: 0,
          dialect: "statistics",
          sourceName: "Third-party gym app"
        })
      );
    }
  }
  return exportXml(lines);
}

function multiRecorderExport(asOf) {
  const lines = [];
  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    // The same day, counted three times over.
    lines.push(steps(day, 9000, "iPhone"));
    lines.push(steps(day, 8600, "Apple Watch"));
    lines.push(steps(day, 4100, "Connect"));
  }
  return exportXml(lines);
}

/**
 * The shape a real export takes when the athlete changed watches.
 *
 * Apple Health is a destination as much as a source. Here an Apple Watch wrote
 * HRV and nothing else, two years ago, and a Garmin syncing in writes today's
 * sleep, resting heart rate and workouts — but no HRV at all. Both are labelled
 * apple_health, and only `sourceName` distinguishes them.
 */
function syncedNotNativeExport(asOf) {
  const lines = [];
  const RETIRED_WATCH = "Poheng's Apple Watch";
  const SYNCED = "Connect";

  // The retired watch's era: HRV only, long ago.
  for (let daysAgo = 700; daysAgo < 707; daysAgo += 1) {
    lines.push(hrv(shiftDay(asOf, daysAgo), 55));
  }

  // Today's era: everything except HRV, synced in from another vendor.
  for (let daysAgo = 0; daysAgo < 14; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    lines.push(steps(day, 7900, SYNCED));
    lines.push(restingHr(day, 52).replace('sourceName="Watch"', `sourceName="${SYNCED}"`));
    lines.push(...sleepStages(day).map((line) => line.replace('sourceName="Watch"', `sourceName="${SYNCED}"`)));
    if (daysAgo % 2 === 1) {
      lines.push(
        workout({ day, type: "HKWorkoutActivityTypeRunning", minutes: 40, kcal: 420, km: 7, sourceName: SYNCED })
      );
    }
  }

  return exportXml(lines.map((line) => line.replace('sourceName="Watch"', `sourceName="${RETIRED_WATCH}"`)));
}

function sparseWearExport(asOf) {
  const lines = [];
  for (let daysAgo = 0; daysAgo < 21; daysAgo += 1) {
    const day = shiftDay(asOf, daysAgo);
    lines.push(steps(day, 6800, "iPhone"));
  }
  // One night, one reading, three weeks apart from nothing else.
  lines.push(hrv(shiftDay(asOf, 9), 58));
  return exportXml(lines);
}

export const APPLE_HEALTH_EXPORTS = {
  complete: (asOf) => completeExport(asOf),
  legacy: (asOf) => completeExport(asOf, { dialect: "on_tag" }),
  sentinels: sentinelExport,
  multiRecorder: multiRecorderExport,
  syncedNotNative: syncedNotNativeExport,
  sparse: sparseWearExport
};

// --- checks ----------------------------------------------------------------

const metricsOf = (events, type) => events.filter((event) => event.type === type);
const workoutsOf = (events) => events.filter((event) => event.kind === "workout");

const speaksCanonicalVocabulary = {
  name: "every parsed signal has a canonical name, not Apple's",
  run: ({ events, canonicalSignals }) => {
    const foreign = [
      ...new Set(events.filter((event) => event.kind === "health_metric").map((event) => event.type))
    ].filter((type) => !canonicalSignals.includes(type));
    return foreign.length === 0 || `not canonical: ${foreign.join(", ")}`;
  }
};

const everySignalIsLabelledAppleHealth = {
  name: "nothing arrives without saying it came from Apple Health",
  run: ({ events }) => {
    const wrong = events.filter((event) => event.source !== "apple_health");
    return wrong.length === 0 || `${wrong.length} events carried source ${wrong[0].source}`;
  }
};

export const APPLE_HEALTH_SCENARIOS = [
  {
    id: "complete_export",
    label: "Complete export — energy and distance where a current export puts them",
    purpose:
      "The reference reading. Everything the registry declares for apple_health must actually come out of a complete export, in canonical names and canonical units.",
    build: APPLE_HEALTH_EXPORTS.complete,
    checks: [
      speaksCanonicalVocabulary,
      everySignalIsLabelledAppleHealth,
      {
        name: "every signal the registry declares for apple_health is actually parsed",
        run: ({ events, declaredSignals }) => {
          const produced = new Set(events.filter((e) => e.kind === "health_metric").map((e) => e.type));
          const undelivered = declaredSignals.filter((signal) => !produced.has(signal));
          return undelivered.length === 0 || `declared but never parsed: ${undelivered.join(", ")}`;
        }
      },
      {
        name: "energy in a nested statistic becomes training load, and says where it came from",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no workouts were parsed";
          const missing = sessions.filter((session) => session.trainingLoad === null);
          if (missing.length > 0) return `${missing.length} of ${sessions.length} sessions carried no load`;
          const wrongSource = sessions.find((session) => session.metadata.loadSource !== "active_energy");
          return !wrongSource || `loadSource was ${wrongSource.metadata.loadSource}`;
        }
      },
      {
        name: "only the asleep stages count toward sleep duration",
        run: ({ events }) => {
          const nights = metricsOf(events, "sleep_duration_hours");
          if (nights.length === 0) return "no sleep was parsed";
          // 240 + 90 + 60 minutes asleep; the 15-minute InBed stage is not sleep.
          const expected = Number((390 / 60).toFixed(2));
          const wrong = nights.find((night) => Math.abs(night.value - expected) > 0.02);
          return !wrong || `a night of ${expected}h asleep was read as ${wrong.value}h`;
        }
      },
      {
        name: "Apple supplies no RPE, so none is invented",
        run: ({ events }) => {
          const invented = workoutsOf(events).filter((session) => session.rpe !== null);
          return invented.length === 0 || `${invented.length} sessions arrived with an rpe Apple never supplied`;
        }
      }
    ]
  },
  {
    id: "legacy_dialect",
    label: "Legacy dialect — energy on the <Workout> tag instead of in a statistic",
    purpose:
      "The same day, written the way an older export wrote it. Reading only the tag is what made every workout in a real 228-session export report no load, so the two dialects must produce the same evidence — not merely both parse.",
    build: APPLE_HEALTH_EXPORTS.legacy,
    equivalentTo: "complete_export",
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "the older dialect still yields training load",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no workouts were parsed";
          const missing = sessions.filter((session) => session.trainingLoad === null);
          return missing.length === 0 || `${missing.length} of ${sessions.length} sessions carried no load`;
        }
      }
    ]
  },
  {
    id: "sentinels_and_gaps",
    label: "Sentinels and gaps — a statistic that exists and says zero",
    purpose:
      "A third-party writer records the session but measures no energy, writing sum=\"0\". Zero calories is not a measurement, and reading it as one would hand the engine a session that looks effortless.",
    build: APPLE_HEALTH_EXPORTS.sentinels,
    checks: [
      everySignalIsLabelledAppleHealth,
      {
        name: "a zero-energy statistic is reported as absent, never as zero load",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no workouts were parsed";
          const leaked = sessions.filter((session) => session.trainingLoad === 0);
          if (leaked.length > 0) return `${leaked.length} sessions carried a load of 0 rather than none`;
          const wrongSource = sessions.find((session) => session.metadata.loadSource !== "unavailable");
          return !wrongSource || `loadSource was ${wrongSource.metadata.loadSource}, expected unavailable`;
        }
      },
      {
        name: "the session itself is still reported — only its load is missing",
        run: ({ events }) => (workoutsOf(events).length > 0 ? true : "sessions vanished along with their load")
      },
      {
        name: "no sleep record produces no sleep signal, not a zero",
        run: ({ events }) =>
          metricsOf(events, "sleep_duration_hours").length === 0 || "sleep appeared from an export that has none"
      }
    ]
  },
  {
    id: "multi_recorder_steps",
    label: "Multi-recorder steps — phone, watch and a synced Garmin count the same day",
    purpose:
      "Three writers record the same steps. Summing them inflates the day; 109 of 2,708 step days in a real export had two or more recorders. The day is the largest single recorder, and it names who was counting.",
    build: APPLE_HEALTH_EXPORTS.multiRecorder,
    checks: [
      {
        name: "a day counted three times is not three times the steps",
        run: ({ events }) => {
          const days = metricsOf(events, "steps");
          if (days.length === 0) return "no steps were parsed";
          const inflated = days.find((day) => day.value > 9000);
          return !inflated || `a day of 9000 / 8600 / 4100 steps became ${inflated.value}`;
        }
      },
      {
        name: "the day is the best single recorder, not the smallest",
        run: ({ events }) => {
          const days = metricsOf(events, "steps");
          const understated = days.find((day) => day.value !== 9000);
          return !understated || `expected 9000 from the leading recorder, got ${understated.value}`;
        }
      },
      {
        name: "who was counting survives into the evidence",
        run: ({ events }) => {
          const day = metricsOf(events, "steps")[0];
          if (!day) return "no steps were parsed";
          if (day.metadata.aggregation !== "daily_max_across_sources") {
            return `aggregation was ${day.metadata.aggregation}`;
          }
          return (
            day.metadata.recorders?.length === 3 ||
            `expected 3 recorders, got ${JSON.stringify(day.metadata.recorders)}`
          );
        }
      }
    ]
  },
  {
    id: "synced_not_native",
    label: "Synced, not native — a retired Apple Watch and a Garmin syncing in",
    purpose:
      "A signal being in an Apple Health export does not mean an Apple Watch measured it. In a real export the only HRV came from a watch that stopped writing in 2023, while every sleep record arrived from Garmin Connect syncing in from 2025-11-12. Told only that \"Apple Health has HRV\", a caller would believe a signal is available that this athlete has not produced in two years. Which device wrote a reading has to survive.",
    build: APPLE_HEALTH_EXPORTS.syncedNotNative,
    checks: [
      speaksCanonicalVocabulary,
      everySignalIsLabelledAppleHealth,
      {
        name: "every reading says which device wrote it",
        run: ({ events }) => {
          const anonymous = events
            .filter((event) => event.kind === "health_metric")
            .filter((event) => !event.metadata?.sourceName && !event.metadata?.recorders?.length);
          return (
            anonymous.length === 0 ||
            `${anonymous.length} readings arrived with no writer: ${[...new Set(anonymous.map((e) => e.type))].join(", ")}`
          );
        }
      },
      {
        name: "sleep synced in from another vendor says so, rather than passing as the watch's",
        run: ({ events }) => {
          const nights = metricsOf(events, "sleep_duration_hours");
          if (nights.length === 0) return "no sleep was parsed";
          const unattributed = nights.filter((night) => !night.metadata?.recorders?.includes("Connect"));
          return unattributed.length === 0 || `${unattributed.length} nights did not name the syncing app`;
        }
      },
      {
        name: "the writers survive all the way into the tool output, not just the evidence",
        run: ({ state }) => {
          const writers = state.provenance?.signalWriters;
          if (!writers) return "provenance carried no signalWriters, so a host cannot see who wrote anything";
          const hrv = writers.hrv_ms;
          const sleep = writers.sleep_duration_hours;
          if (!hrv?.writers?.length) return "hrv reached the output with no writer named";
          if (!sleep?.writers?.length) return "sleep reached the output with no writer named";
          return (
            hrv.latest < sleep.latest ||
            `hrv last written ${hrv.latest} does not read as older than sleep at ${sleep.latest}, so a host cannot see the retired device`
          );
        }
      },
      {
        name: "the retired watch's HRV is not confused with today's readings",
        run: ({ events }) => {
          const readings = metricsOf(events, "hrv_ms");
          if (readings.length === 0) return "no hrv was parsed";
          const fromSync = readings.filter((reading) => reading.metadata?.sourceName === "Connect");
          if (fromSync.length > 0) return `${fromSync.length} hrv readings were attributed to the syncing app`;
          const newest = readings.map((reading) => reading.recordedAt).sort().at(-1);
          const oldestNight = metricsOf(events, "sleep_duration_hours")
            .map((night) => night.recordedAt)
            .sort()[0];
          return (
            newest < oldestNight ||
            `hrv at ${newest} is not older than the synced era starting ${oldestNight}, so the two eras are indistinguishable`
          );
        }
      }
    ]
  },
  {
    id: "sparse_wear",
    label: "Sparse wear — a phone-first export with almost no recovery signal",
    purpose:
      "The shape of a real export: steps every day from the phone, one HRV reading in three weeks, no sleep at all. This must still produce evidence, and must not manufacture the recovery signals it does not have.",
    build: APPLE_HEALTH_EXPORTS.sparse,
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "the signals that exist are still delivered",
        run: ({ events }) =>
          metricsOf(events, "steps").length >= 20 || `only ${metricsOf(events, "steps").length} step days survived`
      },
      {
        name: "one HRV reading stays one reading",
        run: ({ events }) => {
          const readings = metricsOf(events, "hrv_ms");
          return readings.length === 1 || `expected 1 hrv reading, got ${readings.length}`;
        }
      },
      {
        name: "absent sleep and resting heart rate are absent, not zero",
        run: ({ events }) => {
          const fabricated = [
            ...metricsOf(events, "sleep_duration_hours"),
            ...metricsOf(events, "resting_hr_bpm")
          ];
          return fabricated.length === 0 || `${fabricated.length} readings appeared from an export without them`;
        }
      }
    ]
  }
];
