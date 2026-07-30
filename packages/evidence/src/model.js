/**
 * Fitness Evidence Model — the contract for evidence arriving through a tool
 * call.
 *
 * The architecture puts the OAuth arrow between the user's accounts and the AI
 * layer, not between the user and us: the AI holds the authorization and passes
 * evidence in as tool arguments. So this server never fetches from vendor
 * clouds and never holds raw health data — evidence is per-call input, and
 * whether a given source has a server-side API is irrelevant to us.
 *
 * The shape is source-neutral on purpose. Apple Health, Garmin, Oura, and Whoop
 * all speak different dialects; normalizing them into this one vocabulary is
 * the Semantic Fitness Layer's job, and everything downstream only sees this.
 */

/**
 * @typedef {Object} EvidenceMetric
 * @property {"sleep_duration_hours"|"sleep_quality"|"hrv_ms"|"resting_hr_bpm"|"steps"|"stress"} type
 * @property {number} value
 * @property {string} [unit]
 * @property {string} recordedAt   ISO 8601
 * @property {string} [source]     apple_health | garmin | oura | whoop | strava | manual
 */

/**
 * @typedef {Object} EvidenceWorkout
 * @property {string} [id]
 * @property {string} type
 * @property {string} [name]
 * @property {string} startedAt
 * @property {number} durationMinutes
 * @property {number} [rpe]
 * @property {number} [trainingLoad]
 * @property {string[]} [muscleGroups]
 * @property {string} [source]
 */

/**
 * @typedef {Object} FitnessEvidence
 * @property {{ timezone?: string, fitnessLevel?: string }} [profile]
 * @property {Array<{ id?: string, type: string, label?: string, priority?: number }>} [goals]
 * @property {Object} [constraints]
 * @property {EvidenceMetric[]} [healthMetrics]
 * @property {EvidenceWorkout[]} [workouts]
 * @property {VendorAssessment[]} [vendorAssessments]
 */

/**
 * A score the source device already computed. Where a vendor had the sensor on
 * the wrist, its own assessment is better evidence than our re-derivation — so
 * these are carried through rather than discarded.
 *
 * @typedef {Object} VendorAssessment
 * @property {string} source            garmin | oura | whoop | apple_health
 * @property {"vendor_readiness"|"body_battery"|"recovery_time_minutes"|"vendor_acute_load"} type
 * @property {number} value
 * @property {string} [unit]
 * @property {string} recordedAt
 */

const METRIC_TYPES = new Set([
  "sleep_duration_hours",
  "sleep_quality",
  "hrv_ms",
  "resting_hr_bpm",
  "steps",
  "stress"
]);

export function assertValidEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("Evidence must be an object.");
  }
  for (const field of ["healthMetrics", "workouts", "vendorAssessments"]) {
    if (evidence[field] !== undefined && !Array.isArray(evidence[field])) {
      throw new Error(`Evidence.${field} must be an array.`);
    }
  }
  for (const metric of evidence.healthMetrics || []) {
    if (!METRIC_TYPES.has(metric.type)) {
      throw new Error(`Unknown evidence metric type: ${metric.type}`);
    }
    if (typeof metric.value !== "number" || !metric.recordedAt) {
      throw new Error(`Evidence metric ${metric.type} needs a numeric value and recordedAt.`);
    }
  }
  for (const workout of evidence.workouts || []) {
    if (!workout.startedAt || typeof workout.durationMinutes !== "number") {
      throw new Error("Evidence workout needs startedAt and numeric durationMinutes.");
    }
  }
  return true;
}

/**
 * Adapt inbound evidence to the internal context the engines consume. Defaults
 * are filled in so that partial evidence still yields a decision — with the
 * gaps surfaced downstream as reduced confidence rather than hidden.
 *
 * @param {FitnessEvidence} evidence
 * @param {{ userId?: string }} [options]
 */
export function evidenceToUserContext(evidence, options = {}) {
  assertValidEvidence(evidence);
  const constraints = evidence.constraints || {};

  const preferences = [];
  if (typeof constraints.availableMinutes === "number") {
    preferences.push({
      category: "schedule",
      key: "weekday_available_minutes",
      value: constraints.availableMinutes,
      strength: 1
    });
  }
  if (Array.isArray(constraints.avoidMovements) && constraints.avoidMovements.length > 0) {
    preferences.push({ category: "avoid", key: "movements", value: constraints.avoidMovements, strength: 1 });
  }

  return {
    user: {
      id: options.userId || evidence.profile?.userId || "user",
      name: evidence.profile?.name || "User",
      timezone: evidence.profile?.timezone || "UTC",
      heightCm: evidence.profile?.heightCm ?? 175,
      weightKg: evidence.profile?.weightKg ?? 70,
      fitnessLevel: evidence.profile?.fitnessLevel || "intermediate"
    },
    goals: (evidence.goals || []).map((goal, index) => ({
      id: goal.id || `goal_${index}`,
      type: goal.type,
      label: goal.label || goal.type,
      priority: goal.priority ?? index + 1
    })),
    preferences,
    injuries: (constraints.injuries || []).map((injury, index) => ({
      id: injury.id || `injury_${index}`,
      bodyRegion: injury.bodyRegion || "unspecified",
      severity: injury.severity || "moderate",
      restrictions: injury.restrictions || [],
      status: injury.status || "active"
    })),
    equipment: (constraints.equipment || []).map((item) =>
      typeof item === "string"
        ? { type: item, location: "unspecified", available: true }
        : { type: item.type, location: item.location || "unspecified", available: item.available !== false }
    ),
    workouts: (evidence.workouts || []).map((workout, index) => ({
      id: workout.id || `workout_${index}`,
      type: workout.type || "other",
      name: workout.name || workout.type || "Workout",
      startedAt: workout.startedAt,
      durationMinutes: workout.durationMinutes,
      // Absent stays absent. A caller reporting "no RPE" was being overruled
      // with a 5, which then read downstream as something the athlete had said.
      rpe: workout.rpe ?? null,
      trainingLoad: workout.trainingLoad ?? Math.round(workout.durationMinutes * 1.0),
      muscleGroups: workout.muscleGroups || [],
      source: workout.source || "manual",
      // Absent stays absent. There is no sensible default for "how long was
      // this person between 140 and 152 bpm", so nothing is filled in.
      intensityDistribution: workout.intensityDistribution ?? null
    })),
    vendorAssessments: (evidence.vendorAssessments || []).map((item) => ({
      source: item.source || "unknown",
      type: item.type,
      value: item.value,
      unit: item.unit || "",
      recordedAt: item.recordedAt
    })),
    healthMetrics: (evidence.healthMetrics || []).map((metric) => ({
      type: metric.type,
      value: metric.value,
      unit: metric.unit || "",
      recordedAt: metric.recordedAt,
      source: metric.source || "manual"
    }))
  };
}

/** Summarize what evidence actually arrived, for transparency in the output. */
export function describeEvidence(evidence) {
  const metrics = evidence.healthMetrics || [];
  const types = [...new Set(metrics.map((metric) => metric.type))];
  const dates = metrics.map((metric) => metric.recordedAt).sort();
  const workouts = evidence.workouts || [];

  // Per-session intensity is worth naming in provenance on its own: a decision
  // weighed against a known zone distribution rests on different ground than
  // one weighed against a single load number, and the reader should be able to
  // tell which without opening the evidence.
  const withDistribution = workouts.filter((workout) => workout.intensityDistribution);
  const boundarySources = [
    ...new Set(withDistribution.map((workout) => workout.intensityDistribution.boundarySource).filter(Boolean))
  ];

  return {
    metricCount: metrics.length,
    metricTypes: types,
    workoutCount: workouts.length,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
    intensityDistributionCount: withDistribution.length,
    ...(boundarySources.length > 0 ? { intensityBoundarySources: boundarySources } : {})
  };
}
