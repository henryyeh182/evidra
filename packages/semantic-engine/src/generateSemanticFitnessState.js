import { assertValidUserContext } from "../../domain/src/models.js";

const DEFAULT_BASELINES = {
  hrvMs: 52,
  restingHrBpm: 57,
  weeklyTrainingLoadTarget: 360
};

// A recovery signal only counts if its latest reading is recent enough to
// describe *today*. Sparse wearers (e.g. no watch overnight) otherwise get a
// years-old HRV/sleep reading treated as current. Stale signals are dropped and
// the remaining weights are renormalized, so the score reflects what we can
// actually observe instead of neutral filler.
const SIGNAL_STALENESS_DAYS = {
  sleep_duration_hours: 3,
  sleep_quality: 3,
  hrv_ms: 7,
  resting_hr_bpm: 14,
  stress: 7,
  // Vendor composites. Where the device maker had the sensor on the wrist, its
  // own assessment beats anything we can re-derive — so these carry real weight
  // rather than being logged and ignored.
  body_battery: 2,
  recovery_time_minutes: 2,
  vendor_readiness: 2
};

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function getLatestMetric(metrics, type) {
  return metrics
    .filter((metric) => metric.type === type)
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0];
}

function daysBetween(dateA, dateB) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, (dateA.getTime() - dateB.getTime()) / msPerDay);
}

// Latest value for a metric type, but only if it is fresh relative to the
// anchor date. Returns undefined when missing or stale.
function getFreshMetricValue(metrics, type, anchorDate) {
  const latest = getLatestMetric(metrics, type);
  if (!latest) return undefined;
  const ageDays = daysBetween(anchorDate, new Date(latest.recordedAt));
  return ageDays <= SIGNAL_STALENESS_DAYS[type] ? latest.value : undefined;
}

function workoutsWithinDays(workouts, anchorDate, days) {
  return workouts.filter((workout) => {
    const startedAt = new Date(workout.startedAt);
    const ageDays = daysBetween(anchorDate, startedAt);
    return ageDays >= 0 && ageDays <= days;
  });
}

function calculateTrainingLoad(workouts, anchorDate, baselines = DEFAULT_BASELINES) {
  const recent7d = workoutsWithinDays(workouts, anchorDate, 7);
  const recent28d = workoutsWithinDays(workouts, anchorDate, 28);
  const load7d = recent7d.reduce((sum, workout) => sum + workout.trainingLoad, 0);
  const load28d = recent28d.reduce((sum, workout) => sum + workout.trainingLoad, 0);
  const observedChronicWeeklyLoad = load28d / 4 || 0;
  const chronicWeeklyLoad = Math.max(observedChronicWeeklyLoad, baselines.weeklyTrainingLoadTarget);

  return {
    trainingLoad7d: load7d,
    trainingLoad28d: load28d,
    acuteChronicWorkloadRatio: Number((load7d / chronicWeeklyLoad).toFixed(2))
  };
}

function calculateMuscleFatigue(workouts, anchorDate) {
  const fatigue = {};

  for (const workout of workoutsWithinDays(workouts, anchorDate, 7)) {
    const ageDays = daysBetween(anchorDate, new Date(workout.startedAt));
    const decay = Math.max(0.15, 1 - ageDays / 5);
    const fatigueContribution = workout.trainingLoad * (workout.rpe / 10) * decay;

    for (const muscleGroup of workout.muscleGroups) {
      fatigue[muscleGroup] = (fatigue[muscleGroup] || 0) + fatigueContribution;
    }
  }

  return Object.fromEntries(
    Object.entries(fatigue).map(([muscleGroup, value]) => [muscleGroup, clamp(value)])
  );
}

// Sleep score from the freshest available duration/quality readings. Weights
// renormalize over whichever of the two are present, so a duration-only night
// is not dragged toward the middle by an assumed quality of 50.
function calculateSleepScore(metrics, anchorDate) {
  const duration = getFreshMetricValue(metrics, "sleep_duration_hours", anchorDate);
  const quality = getFreshMetricValue(metrics, "sleep_quality", anchorDate);

  if (duration === undefined && quality === undefined) {
    return { score: undefined, present: false };
  }

  const parts = [];
  if (duration !== undefined) parts.push({ score: clamp((duration / 8) * 100), weight: 0.45 });
  if (quality !== undefined) parts.push({ score: clamp(quality), weight: 0.55 });
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = clamp(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight);

  return { score, present: true };
}

// Recovery = weighted blend of the fresh signals only. When all four are
// present and fresh the weights are exactly the original {sleep .35, hrv .35,
// resting .2, stress .1}, so well-instrumented users are unchanged; sparse
// users get an honest, renormalized score plus coverage metadata.
function calculateRecoveryScore(metrics, anchorDate, baselines = DEFAULT_BASELINES, vendorAssessments = []) {
  const sleep = calculateSleepScore(metrics, anchorDate);
  const hrv = getFreshMetricValue(metrics, "hrv_ms", anchorDate);
  const restingHr = getFreshMetricValue(metrics, "resting_hr_bpm", anchorDate);
  const stress = getFreshMetricValue(metrics, "stress", anchorDate);

  // Vendor composites arrive already integrated over signals we may not see.
  const vendorReadiness = getFreshMetricValue(vendorAssessments, "vendor_readiness", anchorDate);
  const bodyBattery = getFreshMetricValue(vendorAssessments, "body_battery", anchorDate);
  const recoveryMinutes = getFreshMetricValue(vendorAssessments, "recovery_time_minutes", anchorDate);

  const signals = {
    sleep: null,
    hrv: null,
    restingHeartRate: null,
    stress: null,
    vendorReadiness: null,
    bodyBattery: null,
    recoveryTime: null
  };
  const parts = [];

  if (sleep.present) {
    signals.sleep = sleep.score;
    parts.push({ name: "sleep", score: sleep.score, weight: 0.35 });
  }
  if (hrv !== undefined) {
    signals.hrv = clamp((hrv / baselines.hrvMs) * 100);
    parts.push({ name: "hrv", score: signals.hrv, weight: 0.35 });
  }
  if (restingHr !== undefined) {
    signals.restingHeartRate = clamp(100 - Math.max(0, restingHr - baselines.restingHrBpm) * 5);
    parts.push({ name: "restingHeartRate", score: signals.restingHeartRate, weight: 0.2 });
  }
  if (stress !== undefined) {
    signals.stress = clamp(100 - stress);
    parts.push({ name: "stress", score: signals.stress, weight: 0.1 });
  }

  // A vendor's own composite is weighted above our raw signals: it was computed
  // with the device on the wrist and integrates inputs we never receive.
  if (vendorReadiness !== undefined) {
    signals.vendorReadiness = clamp(vendorReadiness);
    parts.push({ name: "vendorReadiness", score: signals.vendorReadiness, weight: 0.4 });
  }
  if (bodyBattery !== undefined) {
    signals.bodyBattery = clamp(bodyBattery);
    parts.push({ name: "bodyBattery", score: signals.bodyBattery, weight: 0.3 });
  }
  if (recoveryMinutes !== undefined) {
    // Hours the vendor says are still owed. 24h+ outstanding reads as fully
    // depleted; zero as fully recovered.
    signals.recoveryTime = clamp(100 - Math.min(100, (recoveryMinutes / 1440) * 100));
    parts.push({ name: "recoveryTime", score: signals.recoveryTime, weight: 0.25 });
  }

  const usable = parts.map((part) => part.name);
  const missing = ["sleep", "hrv", "restingHeartRate", "stress"].filter((name) => !usable.includes(name));

  if (parts.length === 0) {
    // No fresh recovery signal at all: neutral score, but say so via coverage.
    return { score: 50, signals, coverage: { usable, missing } };
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = clamp(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight);

  return { score, signals, coverage: { usable, missing } };
}

function calculateReadinessScore(recoveryScore, trainingLoad, muscleFatigue) {
  const workloadPenalty = Math.max(0, trainingLoad.acuteChronicWorkloadRatio - 1.2) * 22;
  const maxMuscleFatigue = Math.max(0, ...Object.values(muscleFatigue));
  const fatiguePenalty = maxMuscleFatigue * 0.22;

  return clamp(recoveryScore - workloadPenalty - fatiguePenalty);
}

// null means "the user never told us", which is not the same as a short day.
// This used to default to 30, and downstream had no way to tell the invented
// number from a stated one — decide_session cut a 60-minute session in half and
// told the athlete their available time was 30 minutes, evidence they had never
// supplied. An unknown constraint is reported as unknown.
function getAvailableMinutes(preferences) {
  const preference = preferences.find(
    (item) => item.category === "schedule" && item.key === "weekday_available_minutes"
  );
  return typeof preference?.value === "number" ? preference.value : null;
}

function getActiveRestrictions(injuries, preferences) {
  const injuryRestrictions = injuries
    .filter((injury) => injury.status === "active")
    .flatMap((injury) => injury.restrictions);

  const avoidedMovements = preferences
    .filter((preference) => preference.category === "avoid")
    .flatMap((preference) => (Array.isArray(preference.value) ? preference.value : [preference.value]))
    .map((value) => `avoid ${value}`);

  return [...new Set([...injuryRestrictions, ...avoidedMovements])];
}

function chooseRecommendedFocus({ readinessScore, muscleFatigue, restrictions, injuries, goals }) {
  const primaryGoal = goals.sort((a, b) => a.priority - b.priority)[0];
  const legFatigue = muscleFatigue.legs || 0;
  const hasKneeRestriction =
    restrictions.some((restriction) => restriction.includes("knee")) ||
    injuries.some((injury) => injury.status === "active" && injury.bodyRegion.includes("knee"));

  if (readinessScore < 45) {
    return "Recovery walk + mobility";
  }

  if (legFatigue > 65 || hasKneeRestriction) {
    return "Low-impact Zone 2 cardio + lower body mobility";
  }

  if (primaryGoal?.type === "half_marathon") {
    return "Easy Zone 2 run";
  }

  if (primaryGoal?.type === "build_muscle") {
    return "Full-body strength";
  }

  return "General fitness session";
}

// Confidence reflects how well we can actually see today: fresh recovery
// signals plus recent training history. Sparse wearers get an honest "low".
function assessConfidence(coverage, recentWorkoutCount) {
  const hasHrv = coverage.usable.includes("hrv");
  const hasSleep = coverage.usable.includes("sleep");
  const hasVendorComposite =
    coverage.usable.includes("vendorReadiness") || coverage.usable.includes("bodyBattery");
  if (hasVendorComposite && coverage.usable.length >= 2 && recentWorkoutCount >= 1) {
    // The device maker already integrated the signals we cannot see.
    return "high";
  }
  if (hasHrv && hasSleep && coverage.usable.length >= 3 && recentWorkoutCount >= 2) {
    return "high";
  }
  if (coverage.usable.length >= 2 && recentWorkoutCount >= 1) {
    return "medium";
  }
  return "low";
}

function buildReasoning({ recovery, readinessScore, trainingLoad, muscleFatigue, restrictions, recommendedFocus }) {
  const usableSignals = recovery.coverage.usable
    .map((name) => `${name} ${recovery.signals[name]}`)
    .join(", ");
  const reasoning = [
    usableSignals
      ? `Recovery score is ${recovery.score}, based on ${usableSignals}.`
      : `Recovery score defaults to ${recovery.score} — no fresh recovery signal is available.`,
    `Readiness score is ${readinessScore} after accounting for training load and recent muscle fatigue.`,
    `7-day training load is ${trainingLoad.trainingLoad7d}; 28-day training load is ${trainingLoad.trainingLoad28d}; acute/chronic ratio is ${trainingLoad.acuteChronicWorkloadRatio}.`
  ];

  if (recovery.coverage.missing.length > 0) {
    reasoning.push(`No fresh reading for: ${recovery.coverage.missing.join(", ")}; those signals were excluded and confidence lowered.`);
  }

  if ((muscleFatigue.legs || 0) > 60) {
    reasoning.push(`Leg fatigue is elevated at ${muscleFatigue.legs}, so heavy lower-body work should be limited today.`);
  }

  if (restrictions.length > 0) {
    reasoning.push(`Active constraints include: ${restrictions.join("; ")}.`);
  }

  reasoning.push(`Recommended focus: ${recommendedFocus}.`);

  return reasoning;
}

export function generateSemanticFitnessState(context, options = {}) {
  assertValidUserContext(context);

  const date = options.date || new Date().toISOString().slice(0, 10);
  const timezone = options.timezone || context.user.timezone;
  const anchorDate = new Date(`${date}T23:59:59${timezone === "Asia/Taipei" ? "+08:00" : "Z"}`);
  const trainingLoad = calculateTrainingLoad(context.workouts, anchorDate, options.baselines);
  const muscleFatigue = calculateMuscleFatigue(context.workouts, anchorDate);
  const recovery = calculateRecoveryScore(
    context.healthMetrics,
    anchorDate,
    options.baselines,
    context.vendorAssessments || []
  );
  const readinessScore = calculateReadinessScore(recovery.score, trainingLoad, muscleFatigue);
  const restrictions = getActiveRestrictions(context.injuries, context.preferences);
  const recommendedFocus = chooseRecommendedFocus({
    readinessScore,
    muscleFatigue,
    restrictions,
    injuries: context.injuries,
    goals: [...context.goals]
  });
  const recentWorkoutCount = workoutsWithinDays(context.workouts, anchorDate, 14).length;

  return {
    userId: context.user.id,
    date,
    timezone,
    recoveryScore: recovery.score,
    readinessScore,
    fatigueScore: clamp(100 - readinessScore),
    sleepQuality: recovery.signals.sleep,
    trainingLoad7d: trainingLoad.trainingLoad7d,
    trainingLoad28d: trainingLoad.trainingLoad28d,
    acuteChronicWorkloadRatio: trainingLoad.acuteChronicWorkloadRatio,
    muscleFatigue,
    recommendedFocus,
    avoid: restrictions,
    availableTimeMinutes: getAvailableMinutes(context.preferences),
    goalAlignment: {
      primaryGoal: context.goals.sort((a, b) => a.priority - b.priority)[0]?.type || "general_fitness",
      score: readinessScore >= 55 ? 0.76 : 0.52
    },
    signalCoverage: recovery.coverage,
    confidence: assessConfidence(recovery.coverage, recentWorkoutCount),
    reasoning: buildReasoning({
      recovery,
      readinessScore,
      trainingLoad,
      muscleFatigue,
      restrictions,
      recommendedFocus
    })
  };
}
