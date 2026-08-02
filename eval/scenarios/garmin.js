/**
 * Garmin source-schema simulation scenarios.
 *
 * These exist to train and verify **schema comprehension** — the Semantic
 * Fitness Layer's ability to read a vendor's dialect and land it in the
 * canonical vocabulary (moat #1). They are not a tuning set: nothing here
 * calibrates a threshold, and no check asserts what a particular person's
 * readiness ought to be. The product is a decision engine, not a Garmin
 * connector, and simulated physiology is worth exactly nothing as a target to
 * fit.
 *
 * So the axis of variation is the *shape of the export*, not the story of an
 * athlete:
 *
 *   complete_export      every field Garmin can supply is present
 *   sentinels_and_gaps   level NONE, restingHeartRate 0, stress -1, no sleep record
 *   dialect_equivalence  the same day written two ways must normalize identically
 *   lossy_export         fields Garmin often omits are omitted
 *   sparse_wear          the watch is worn only intermittently
 *
 * The values carried through are ordinary and deliberately unremarkable — they
 * are freight, not ground truth. What is asserted is that the freight arrives
 * with the right name, the right unit, the right source label, and that what
 * did not arrive is reported as missing instead of invented.
 */

const DAY_MS = 86400000;

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** An ordinary session. Its numbers are freight; no check reads meaning into them. */
function session(load, { name = "Zone 2 Run", typeKey = "running" } = {}) {
  const minutes = Math.max(20, Math.round(load / 1.7));
  return {
    typeKey,
    name,
    minutes,
    distanceMeters: minutes * 168,
    avgHr: 138,
    maxHr: 157,
    aerobic: 2.8,
    anaerobic: 0.4
  };
}

/** A repeating week of load, indexed backwards from asOf so runs are stable. */
const week = (pattern) => (daysAgo) => pattern[daysAgo % 7];
const BASE_WEEK = week([0, 58, 0, 46, 0, 74, 0]);

/** A fully instrumented day: every field Garmin is capable of supplying. */
function completeDay(daysAgo) {
  const load = BASE_WEEK(daysAgo);
  return {
    load,
    activity: load > 0 ? session(load) : null,
    recoveryTimeMinutes: load > 0 ? 300 : 60,
    readiness: { score: 78, level: "MODERATE" },
    bodyBattery: { high: 86, low: 30 },
    sleep: { hours: 7.5, score: 80 },
    restingHr: 54,
    stress: 30,
    steps: 9600
  };
}

const PROFILE = { timezone: "UTC", fitnessLevel: "intermediate" };
const GOALS = [{ type: "half_marathon", label: "Half marathon", priority: 1 }];
const CONSTRAINTS = { availableMinutes: 60 };

/** The prior state a decision acts on. Present so the pipeline is exercised to
 *  its end — never so a check can assert what it should become. */
const SCHEDULED_SESSION = {
  focus: "Tempo Run",
  type: "run",
  durationMinutes: 50,
  intensity: "high",
  targetMuscleGroups: ["legs"],
  exercises: ["Tempo Run", "Strides"]
};

// ---- shared checks --------------------------------------------------------

/** Everything the connector emits must speak the canonical vocabulary. */
const speaksCanonicalVocabulary = {
  name: "every emitted signal is canonical, garmin-labelled, and correctly united",
  run: ({ evidence, canonicalSignals }) => {
    const problems = [];
    for (const metric of evidence.healthMetrics) {
      const spec = canonicalSignals[metric.type];
      if (!spec) problems.push(`unknown signal ${metric.type}`);
      else if (metric.unit !== spec.unit) problems.push(`${metric.type} arrived as ${metric.unit}, registry says ${spec.unit}`);
      if (metric.source !== "garmin") problems.push(`${metric.type} lost its source label (${metric.source})`);
    }
    for (const assessment of evidence.vendorAssessments) {
      const spec = canonicalSignals[assessment.type];
      if (!spec) problems.push(`unknown composite ${assessment.type}`);
      else if (!spec.composite) problems.push(`${assessment.type} is not a vendor composite`);
      if (assessment.source !== "garmin") problems.push(`${assessment.type} lost its source label`);
    }
    return problems.length === 0 || problems.slice(0, 3).join("; ");
  }
};

/** Commitment A: whatever the shape, the decision explains itself. */
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

/** Garmin never supplies a usable HRV series, and the layer must not pretend. */
const hrvIsNeverInvented = {
  name: "hrv is reported missing — Garmin's weekly average is stale, not a reading",
  run: ({ state, evidence }) => {
    if (evidence.healthMetrics.some((metric) => metric.type === "hrv_ms")) {
      return "an hrv_ms reading was manufactured from the export";
    }
    return state.signalCoverage.recovery.missing.includes("hrv") || "hrv was not reported as missing";
  }
};

// ---- the scenarios --------------------------------------------------------

export const GARMIN_SCENARIOS = [
  {
    id: "complete_export",
    label: "Complete export — every field Garmin can supply",
    purpose:
      "The reference reading. If the registry declares Garmin supplies a signal, a complete export must actually produce it — a mapping table that promises more than the parser delivers is the failure this catches.",
    days: 70,
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day: completeDay,
    checks: [
      speaksCanonicalVocabulary,
      {
        name: "every signal the registry declares for garmin is actually parsed",
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
        name: "units are converted, not passed through (seconds -> hours, ms -> minutes)",
        run: ({ evidence, rawExport }) => {
          const night = rawExport.sleep.at(-1);
          const sleep = evidence.healthMetrics
            .filter((metric) => metric.type === "sleep_duration_hours")
            .at(-1);
          const expectedHours = Number((night.sleepTimeSeconds / 3600).toFixed(2));
          if (!sleep) return "no sleep duration was parsed";
          if (sleep.value !== expectedHours) return `${night.sleepTimeSeconds}s became ${sleep.value}h, expected ${expectedHours}h`;

          const activity = rawExport.activities.at(-1);
          const workout = evidence.workouts.at(-1);
          const expectedMinutes = Math.round(activity.duration / 60000);
          return (
            workout.durationMinutes === expectedMinutes ||
            `${activity.duration}ms became ${workout.durationMinutes}min, expected ${expectedMinutes}min`
          );
        }
      },
      {
        name: "Garmin's own load is preferred over a duration estimate, and says so",
        run: ({ evidence, rawExport }) => {
          const activity = rawExport.activities.at(-1);
          const workout = evidence.workouts.at(-1);
          if (workout.trainingLoad !== activity.activityTrainingLoad) {
            return `load ${workout.trainingLoad} ignored Garmin's ${activity.activityTrainingLoad}`;
          }
          return workout.metadata.loadSource === "garmin_epoc" || `loadSource was ${workout.metadata.loadSource}`;
        }
      },
      hrvIsNeverInvented,
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "sentinels_and_gaps",
    label: "Sentinels and gaps — four nights without the watch",
    purpose:
      "Garmin encodes 'not measured' as values, not as absence: level NONE, restingHeartRate 0, averageStressLevel -1, and no sleep record at all. Reading those literally would turn an unworn watch into a calm, rested athlete. This is the most common real-world shape, not an edge case.",
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
        readiness: null, // Garmin returns the record with level NONE and no score
        sleep: null, // no night was recorded at all
        restingHr: 0, // not-measured sentinel
        stress: -1, // not-measured sentinel
        bodyBattery: { high: 58, low: 21 } // daytime wear still yields this
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
          const negative = evidence.healthMetrics.filter((metric) => metric.value < 0);
          if (leaked.length > 0) return `${leaked[0].type}=${leaked[0].value} was read as a measurement`;
          return negative.length === 0 || `a negative sentinel survived as ${negative[0].type}`;
        }
      },
      {
        name: "a readiness score Garmin declined to compute is not used",
        run: ({ evidence, state, asOf }) => {
          const recent = evidence.vendorAssessments.filter(
            (assessment) =>
              assessment.type === "vendor_readiness" &&
              assessment.recordedAt >= new Date(new Date(`${asOf}T00:00:00Z`).getTime() - 4 * DAY_MS).toISOString()
          );
          if (recent.length > 0) return "a NONE-level readiness record was emitted as a score";
          return (
            !state.signalCoverage.recovery.usable.includes("vendorReadiness") ||
            "vendor readiness was used on days Garmin had none"
          );
        }
      },
      {
        name: "the nights that were never recorded are reported as missing sleep",
        run: ({ state }) =>
          state.signalCoverage.recovery.missing.includes("sleep") || `missing was ${state.signalCoverage.recovery.missing.join(", ")}`
      },
      {
        name: "what Garmin can still supply off-wrist is read instead of giving up",
        run: ({ state }) => {
          const usable = state.signalCoverage.recovery.usable;
          return (
            (usable.includes("bodyBattery") && usable.includes("recoveryTime")) ||
            `usable signals were ${usable.join(", ")}`
          );
        }
      },
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "dialect_equivalence",
    label: "Dialect equivalence — the same day written two ways",
    purpose:
      "Garmin exports vary by tool and vintage: activityType may be a {typeKey} object or a bare string, dates may be calendarDate or an epoch timestamp, a night may be keyed by calendarDate or sleepStartTimestampGMT. Different spellings of the same physiological fact must normalize to the same canonical evidence — that identity is what makes the layer a translation and not a per-format special case.",
    days: 70,
    dialects: ["modern", "legacy"],
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day: completeDay,
    checks: [speaksCanonicalVocabulary, decisionRemainsSelfExplaining]
  },

  {
    id: "lossy_export",
    label: "Lossy export — the fields Garmin routinely omits",
    purpose:
      "Measured over one real 328-record export: acuteLoad present 70% of days, bodyBattery 76%. Sessions logged from a phone carry no EPOC training load, and a night can be timed without being scored. The layer must degrade by narrowing what it claims, never by filling the hole with a plausible number.",
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
        name: "a workout without Garmin's load is still usable, and labelled as estimated",
        run: ({ evidence }) => {
          const workout = evidence.workouts.at(-1);
          if (!workout) return "no workout was parsed";
          if (workout.metadata.loadSource !== "duration_estimate") {
            return `loadSource was ${workout.metadata.loadSource}`;
          }
          return workout.trainingLoad > 0 || "the estimate produced no load at all";
        }
      },
      {
        name: "a night timed but not scored yields duration only, never an invented quality",
        run: ({ evidence }) => {
          const hasDuration = evidence.healthMetrics.some((metric) => metric.type === "sleep_duration_hours");
          const hasQuality = evidence.healthMetrics.some((metric) => metric.type === "sleep_quality");
          if (!hasDuration) return "the timed night was dropped entirely";
          return !hasQuality || "a sleep quality score appeared without Garmin scoring the night";
        }
      },
      {
        name: "Body Battery without its daily high is omitted rather than guessed",
        run: ({ evidence }) =>
          !evidence.vendorAssessments.some((assessment) => assessment.type === "body_battery") ||
          "a body battery value was produced from an incomplete stat list"
      },
      decisionRemainsSelfExplaining
    ]
  },

  {
    id: "sparse_wear",
    label: "Sparse wear — the watch comes out once or twice a week",
    purpose:
      "Not every user is an every-night wearer. With records only every third day, the layer must let the coverage report shrink honestly rather than carrying an old reading forward as though it described today.",
    days: 70,
    profile: PROFILE,
    goals: GOALS,
    constraints: CONSTRAINTS,
    scheduledSession: SCHEDULED_SESSION,
    day(daysAgo) {
      const day = completeDay(daysAgo);
      // Records every third day, and none for the two days before asOf — the
      // freshest reading is already a couple of days old when the call arrives.
      if (daysAgo % 3 === 2) return day;
      return { ...day, readiness: null, sleep: null, bodyBattery: null, restingHr: 0, stress: -1 };
    },
    checks: [
      speaksCanonicalVocabulary,
      hrvIsNeverInvented,
      {
        name: "no reading is fabricated for a day the export has no record for",
        run: ({ evidence, rawExport }) => {
          const recorded = new Set(rawExport.sleep.map((record) => record.calendarDate));
          const parsed = new Set(
            evidence.healthMetrics
              .filter((metric) => metric.type === "sleep_duration_hours")
              .map((metric) => metric.recordedAt.slice(0, 10))
          );
          const invented = [...parsed].filter((day) => !recorded.has(day));
          const dropped = [...recorded].filter((day) => !parsed.has(day));
          if (invented.length > 0) return `nights appeared that the export never contained: ${invented.slice(0, 2)}`;
          return dropped.length === 0 || `recorded nights were lost in normalization: ${dropped.slice(0, 2)}`;
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

// ---- rendering into Garmin's dialects -------------------------------------

const DIALECTS = {
  /** Current Garmin Connect export shape. */
  modern: {
    readinessDate: (date) => ({ calendarDate: date }),
    sleepDate: (date) => ({ calendarDate: date }),
    activityType: (typeKey) => ({ typeKey }),
    omitTrainingLoad: false,
    omitSleepScore: false,
    omitAcuteLoad: false,
    partialBodyBattery: false
  },
  /** Older/alternative spellings of the same facts. */
  legacy: {
    readinessDate: (date) => ({ timestamp: Date.parse(`${date}T12:00:00Z`) }),
    sleepDate: (date) => ({ sleepStartTimestampGMT: Date.parse(`${date}T12:00:00Z`) }),
    activityType: (typeKey) => typeKey,
    omitTrainingLoad: false,
    omitSleepScore: false,
    omitAcuteLoad: false,
    partialBodyBattery: false
  },
  /** Everything Garmin commonly leaves out. */
  lossy: {
    readinessDate: (date) => ({ calendarDate: date }),
    sleepDate: (date) => ({ calendarDate: date }),
    activityType: (typeKey) => typeKey,
    omitTrainingLoad: true,
    omitSleepScore: true,
    omitAcuteLoad: true,
    partialBodyBattery: true
  }
};

export const GARMIN_DIALECTS = Object.keys(DIALECTS);

/**
 * Render a scenario as a Garmin Connect export.
 *
 * Only this function knows Garmin's field names, its millisecond durations and
 * its not-measured sentinels. A scenario that says "the watch was off the
 * wrist" becomes `level: "NONE"`, `restingHeartRate: 0` and
 * `averageStressLevel: -1` here — so the connector is read against the same
 * awkward shapes a real export contains, rather than a tidied-up one.
 *
 * @param {object} scenario one of GARMIN_SCENARIOS
 * @param {{ asOf: string, dialect?: string }} options
 */
export function buildGarminExport(scenario, { asOf, dialect } = {}) {
  const spelling = DIALECTS[dialect || scenario.dialect || "modern"];
  if (!spelling) throw new Error(`Unknown Garmin dialect: ${dialect}`);

  const days = [];
  for (let daysAgo = scenario.days - 1; daysAgo >= 0; daysAgo -= 1) {
    days.push({ daysAgo, date: shiftDay(asOf, daysAgo), ...scenario.day(daysAgo) });
  }

  // Garmin's acuteLoad is its own rolling 7-day figure. Deriving it here keeps
  // it consistent with the sessions by construction.
  const acuteLoadAt = (index) =>
    days.slice(Math.max(0, index - 6), index + 1).reduce((sum, day) => sum + (day.load || 0), 0);

  const readiness = [];
  const dailySummaries = [];
  const sleep = [];
  const activities = [];

  days.forEach((day, index) => {
    readiness.push({
      ...spelling.readinessDate(day.date),
      score: day.readiness?.score ?? null,
      level: day.readiness?.level ?? "NONE",
      recoveryTime: day.recoveryTimeMinutes ?? 0,
      ...(spelling.omitAcuteLoad ? {} : { acuteLoad: acuteLoadAt(index) }),
      // 511 on every single day, which is what a real export carries when the
      // device does not measure HRV: 2^9-1, a not-measured sentinel wearing the
      // shape of a number. Measured across 330 consecutive days. A parser that
      // mapped it would report a rock-steady HRV to an athlete who has none.
      hrvWeeklyAverage: 511
    });

    const batteryStats = day.bodyBattery
      ? [
          { bodyBatteryStatType: "LOWEST", statsValue: day.bodyBattery.low },
          ...(spelling.partialBodyBattery
            ? []
            : [{ bodyBatteryStatType: "HIGHEST", statsValue: day.bodyBattery.high }])
        ]
      : null;

    dailySummaries.push({
      calendarDate: day.date,
      restingHeartRate: day.restingHr ?? 0,
      totalSteps: day.steps ?? 0,
      averageStressLevel: day.stress ?? -1,
      bodyBattery: batteryStats ? { bodyBatteryStatList: batteryStats } : null
    });

    if (day.sleep) {
      sleep.push({
        ...spelling.sleepDate(day.date),
        sleepTimeSeconds: Math.round(day.sleep.hours * 3600),
        deepSleepSeconds: Math.round(day.sleep.hours * 3600 * 0.18),
        remSleepSeconds: Math.round(day.sleep.hours * 3600 * 0.22),
        ...(spelling.omitSleepScore || !day.sleep.score
          ? {}
          : { sleepScores: { overall: { value: day.sleep.score, qualifierKey: "SIMULATED" } } })
      });
    }

    if (day.activity) {
      const activity = day.activity;
      activities.push({
        activityId: Number(`100000${String(index).padStart(3, "0")}`),
        name: activity.name,
        activityType: spelling.activityType(activity.typeKey),
        beginTimestamp: Date.parse(`${day.date}T07:00:00Z`),
        duration: activity.minutes * 60000,
        distance: activity.distanceMeters ?? null,
        avgHr: activity.avgHr,
        maxHr: activity.maxHr,
        ...(spelling.omitTrainingLoad ? {} : { activityTrainingLoad: day.load }),
        aerobicTrainingEffect: activity.aerobic,
        anaerobicTrainingEffect: activity.anaerobic
      });
    }
  });

  return { readiness, dailySummaries, sleep, activities };
}
