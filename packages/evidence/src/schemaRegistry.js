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
  vendor_acute_load: { unit: "load", domain: "load", composite: true }
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
    label: "Strava",
    access: "oauth_cloud",
    // Activity-only: Strava carries no recovery physiology at all. A decision
    // for a Strava-only user rests on training load, and must say so.
    signals: []
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
