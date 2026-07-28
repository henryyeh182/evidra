/**
 * Vendor schema registry — the Semantic Fitness Layer's mapping table.
 *
 * Every platform names and scales the same physiology differently. Garmin calls
 * a night's sleep `sleepTimeSeconds`, Apple emits
 * `HKCategoryTypeIdentifierSleepAnalysis` intervals, Oura returns
 * `total_sleep_duration`, Whoop `sleep.score.stage_summary`. None of that
 * should reach a decision rule.
 *
 * Adding a platform means adding a mapping here — not writing another parser
 * and not touching anything downstream. That is the whole point of the layer:
 * the decision engine only ever sees the unified vocabulary.
 */

/** The unified vocabulary. Everything downstream speaks only these. */
export const CANONICAL_SIGNALS = {
  sleep_duration_hours: { unit: "hours", domain: "recovery" },
  sleep_quality: { unit: "score_0_100", domain: "recovery" },
  hrv_ms: { unit: "ms", domain: "recovery" },
  resting_hr_bpm: { unit: "bpm", domain: "recovery" },
  stress: { unit: "score_0_100", domain: "recovery" },
  steps: { unit: "count", domain: "activity" },
  // Vendor composites: already-integrated scores from the device maker.
  vendor_readiness: { unit: "score_0_100", domain: "recovery", composite: true },
  body_battery: { unit: "score_0_100", domain: "recovery", composite: true },
  recovery_time_minutes: { unit: "minutes", domain: "recovery", composite: true },
  vendor_acute_load: { unit: "load", domain: "load", composite: true },
  // Per-session load. Everything above describes a day; these describe one
  // workout. They exist because an activity-only source carries no physiology
  // at all — its entire evidentiary contribution is how hard each session was,
  // and a decision built on that has to be able to name it.
  session_relative_effort: { unit: "score", domain: "load", composite: true, perSession: true },
  session_training_load: { unit: "tss", domain: "load", composite: true, perSession: true },
  session_intensity_factor: { unit: "percent_of_threshold", domain: "load", composite: true, perSession: true }
};

const hours = (seconds) => Number((seconds / 3600).toFixed(2));
const minutes = (seconds) => Math.round(seconds / 60);
const identity = (value) => value;

/**
 * Per-vendor field mappings. `from` is the vendor's field path, `to` a
 * canonical signal, `convert` reconciles units, and `scale` documents the
 * vendor's own range so a 0–10 stress score is never blended with a 0–100 one.
 */
export const VENDOR_SCHEMAS = {
  apple_health: {
    label: "Apple Health (HealthKit)",
    access: "device_local",
    signals: [
      { from: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", to: "hrv_ms", convert: identity, scale: "ms" },
      { from: "HKQuantityTypeIdentifierRestingHeartRate", to: "resting_hr_bpm", convert: identity, scale: "bpm" },
      { from: "HKQuantityTypeIdentifierStepCount", to: "steps", convert: identity, scale: "count", aggregate: "daily_sum" },
      { from: "HKCategoryTypeIdentifierSleepAnalysis", to: "sleep_duration_hours", convert: hours, scale: "seconds", aggregate: "per_night_sum" }
    ]
  },

  garmin: {
    label: "Garmin Connect",
    access: "oauth_cloud",
    signals: [
      { from: "restingHeartRate", to: "resting_hr_bpm", convert: identity, scale: "bpm" },
      { from: "totalSteps", to: "steps", convert: identity, scale: "count" },
      { from: "averageStressLevel", to: "stress", convert: identity, scale: "0-100" },
      { from: "sleepTimeSeconds", to: "sleep_duration_hours", convert: hours, scale: "seconds" },
      { from: "sleepScores.overall.value", to: "sleep_quality", convert: identity, scale: "0-100" },
      // Garmin composites
      { from: "score", to: "vendor_readiness", convert: identity, scale: "0-100", requires: "level !== NONE" },
      { from: "bodyBattery.HIGHEST", to: "body_battery", convert: identity, scale: "0-100" },
      { from: "recoveryTime", to: "recovery_time_minutes", convert: identity, scale: "minutes" },
      { from: "acuteLoad", to: "vendor_acute_load", convert: identity, scale: "load" }
    ]
  },

  google_health_connect: {
    label: "Google Health Connect",
    access: "device_local",
    signals: [
      { from: "HeartRateVariabilityRmssd.heartRateVariabilityMillis", to: "hrv_ms", convert: identity, scale: "ms" },
      { from: "RestingHeartRate.beatsPerMinute", to: "resting_hr_bpm", convert: identity, scale: "bpm" },
      { from: "Steps.count", to: "steps", convert: identity, scale: "count", aggregate: "daily_sum" },
      { from: "SleepSession.stages", to: "sleep_duration_hours", convert: hours, scale: "seconds", aggregate: "per_night_sum" }
    ]
  },

  oura: {
    label: "Oura Ring",
    access: "oauth_cloud",
    signals: [
      { from: "daily_sleep.total_sleep_duration", to: "sleep_duration_hours", convert: hours, scale: "seconds" },
      { from: "daily_sleep.score", to: "sleep_quality", convert: identity, scale: "0-100" },
      { from: "daily_sleep.contributors.hrv_balance", to: "hrv_ms", convert: identity, scale: "ms" },
      { from: "daily_sleep.lowest_heart_rate", to: "resting_hr_bpm", convert: identity, scale: "bpm" },
      { from: "daily_readiness.score", to: "vendor_readiness", convert: identity, scale: "0-100" },
      { from: "daily_activity.steps", to: "steps", convert: identity, scale: "count" }
    ]
  },

  whoop: {
    label: "WHOOP",
    access: "oauth_cloud",
    signals: [
      { from: "recovery.score.recovery_score", to: "vendor_readiness", convert: identity, scale: "0-100" },
      { from: "recovery.score.hrv_rmssd_milli", to: "hrv_ms", convert: identity, scale: "ms" },
      { from: "recovery.score.resting_heart_rate", to: "resting_hr_bpm", convert: identity, scale: "bpm" },
      { from: "sleep.score.stage_summary.total_in_bed_time_milli", to: "sleep_duration_hours", convert: (ms) => hours(ms / 1000), scale: "milliseconds" },
      { from: "sleep.score.sleep_performance_percentage", to: "sleep_quality", convert: identity, scale: "0-100" },
      { from: "cycle.score.strain", to: "vendor_acute_load", convert: identity, scale: "0-21" }
    ]
  },

  strava: {
    label: "Strava (OAuth API)",
    access: "oauth_cloud",
    // Activity-only: Strava carries no recovery physiology at all. A decision
    // for a Strava-only user rests on per-session load, and must say so.
    signals: [
      { from: "suffer_score", to: "session_relative_effort", convert: identity, scale: "0-300", perSession: true }
    ]
  },

  // Strava's bulk data export ("Download Request") is a *different dialect* of
  // the same platform, not the same fields in a file. It is the only Strava
  // route that needs no OAuth, so it is how an athlete hands over history
  // without granting standing access — which makes its traps worth naming.
  strava_export: {
    label: "Strava (bulk data export)",
    access: "user_export",
    dialectOf: "strava",
    signals: [
      // `Relative Effort` is HR-derived and present on every activity — the
      // only load signal that survives when the session has no power.
      {
        from: "Relative Effort",
        column: 37,
        to: "session_relative_effort",
        convert: identity,
        scale: "0-300",
        perSession: true,
        duplicateHeader: [8, 37]
      },
      // `Training Load` and `Intensity` are FTP-relative and only exist when
      // the session recorded weighted average power. Verified against an
      // export: Intensity = round(NP / FTP x 100) and Training Load =
      // (movingSeconds x NP x IF) / (FTP x 3600) x 100 — i.e. TSS. Both are
      // therefore comparable *within* one athlete only, and silently drift
      // when the FTP in general_preferences.csv is stale.
      {
        from: "Training Load",
        column: 88,
        to: "session_training_load",
        convert: identity,
        scale: "tss",
        perSession: true,
        requires: "Weighted Average Power",
        relativeTo: "functionalThresholdPowerWatts"
      },
      {
        from: "Intensity",
        column: 89,
        to: "session_intensity_factor",
        convert: identity,
        scale: "0-100",
        perSession: true,
        requires: "Weighted Average Power",
        relativeTo: "functionalThresholdPowerWatts"
      }
    ],

    /**
     * Athlete thresholds from `general_preferences.csv`. Not observations, so
     * not canonical signals — but the load columns above are expressed as
     * percentages of them, so a reader that ignores this file cannot say what
     * a Training Load of 19 means.
     */
    anchors: {
      functionalThresholdPowerWatts: "Functional Threshold Power",
      maxHeartRateBpm: "Maximum Heartrate",
      dateOfBirth: "Date of Birth",
      weightKg: "Weight",
      athleteType: "Athlete Type",
      // Decides whether the localized distance/elevation columns are metric or
      // imperial. Without it those columns have no unit.
      measurementPreference: "Measurement Preference"
    },

    /**
     * Traps in the file format itself. Each one has produced a wrong number in
     * a naive reader, so they are recorded here rather than in a parser
     * comment: this is the layer that is supposed to know the dialect.
     */
    quirks: {
      duplicateHeaders:
        "activities.csv repeats five header names with different units. The first ~13 columns are a display block (localized), the rest are raw metrics: `Distance`[6] is 5.67 (km, per measurementPreference) while `Distance`[17] is 5671.4 (metres). Also duplicated: Elapsed Time [5,15], Max Heart Rate [7,30], Relative Effort [8,37], Commute [9,50] (\"false\" vs 0.0). Parse by column index, never by header name.",
      dateIsUtcWithoutOffset:
        "`Activity Date` (\"Jul 26, 2026, 1:45:16 AM\") is UTC and the CSV carries no offset anywhere. Bucketing these into training days without the athlete's timezone misfiles every session that starts before 08:00 local in Asia/Taipei. The offset is recoverable, but only from activities/<file>.fit.gz — see `recoveredFromFit`.",
      recoveredFromFit:
        "The FIT `activity` message carries both `timestamp` (UTC) and `local_timestamp`; their difference is the athlete's UTC offset for that session, and it is per-activity, so a history that spans travel has more than one. That is a fixed offset, not an IANA timezone name — no FIT file names a zone. Reading it costs one file open per activity, so it is opt-in.",
      filenameIdIsNotActivityId:
        "The number in `Filename` (activities/20588763590.fit.gz) is the upload id, not `Activity ID` (19466953554). Two id spaces; joining on it silently matches nothing.",
      perActivityStepsAreNotDailySteps:
        "`Total Steps`[85] counts one activity, not one day. It is deliberately not mapped to the canonical `steps` signal — summing it would understate a day and blending it with a daily total would be a silent lie.",
      maxHeartRateMayBeAgeEstimate:
        "`Maximum Heartrate` defaults to 220 - age unless the athlete overrode it. Relative Effort inherits that estimate, so a Relative Effort built on an unedited default deserves lower confidence than one built on a measured max."
    },

    /**
     * Files in the export archive that carry evidence. Everything else
     * (followers, clubs, reactions, partner opt-outs, ...) is social/account
     * data and is not read.
     */
    files: {
      "activities.csv": "one row per activity; 103 columns",
      "general_preferences.csv": "athlete thresholds — see `anchors`",
      "structured_details.csv":
        "per-set strength data: Activity ID, Exercise Name, Repetitions, Duration (seconds), Weight, Start Time (milliseconds), Superset ID, Rate of Perceived Exertion. The only Strava file that reaches exercise level.",
      "profile.csv": "athlete identity plus Health Consent Status",
      "activities/*.fit.gz": "per-activity FIT streams; the only place the local UTC offset survives"
    }
  }
};

/**
 * What a given set of sources can and cannot tell us. Callers use this to
 * explain, before any decision is made, which physiology is simply unavailable
 * for this user's device mix — a Strava-only athlete has no recovery signal at
 * all, and that is a property of their sources, not a failure of the model.
 *
 * @param {string[]} sources
 */
export function describeSourceCoverage(sources = []) {
  const provided = new Set();
  const known = [];
  const unknown = [];

  for (const source of sources) {
    const schema = VENDOR_SCHEMAS[source];
    if (!schema) {
      unknown.push(source);
      continue;
    }
    known.push(source);
    for (const mapping of schema.signals) provided.add(mapping.to);
  }

  const recoverySignals = Object.entries(CANONICAL_SIGNALS)
    .filter(([, meta]) => meta.domain === "recovery")
    .map(([name]) => name);

  return {
    sources: known,
    unknownSources: unknown,
    availableSignals: [...provided].sort(),
    missingRecoverySignals: recoverySignals.filter((signal) => !provided.has(signal)),
    hasRecoveryEvidence: recoverySignals.some((signal) => provided.has(signal))
  };
}

/** Which vendors can supply a given canonical signal — useful for onboarding. */
export function sourcesProviding(signal) {
  return Object.entries(VENDOR_SCHEMAS)
    .filter(([, schema]) => schema.signals.some((mapping) => mapping.to === signal))
    .map(([name]) => name);
}
