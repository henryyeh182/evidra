import { assertValidUserContext } from "../../domain/src/models.js";

const DEFAULT_BASELINES = {
  hrvMs: 52,
  restingHrBpm: 57,
  weeklyTrainingLoadTarget: 360
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

function calculateSleepScore(metrics) {
  const duration = getLatestMetric(metrics, "sleep_duration_hours")?.value;
  const quality = getLatestMetric(metrics, "sleep_quality")?.value;

  if (duration === undefined && quality === undefined) {
    return { score: 50, reason: "No recent sleep data is available." };
  }

  const durationScore = duration === undefined ? 50 : clamp((duration / 8) * 100);
  const qualityScore = quality === undefined ? 50 : clamp(quality);
  const score = clamp(durationScore * 0.45 + qualityScore * 0.55);

  return {
    score,
    reason: `Sleep score is based on ${duration ?? "unknown"}h duration and ${quality ?? "unknown"} quality.`
  };
}

function calculateRecoveryScore(metrics, baselines = DEFAULT_BASELINES) {
  const hrv = getLatestMetric(metrics, "hrv_ms")?.value;
  const restingHr = getLatestMetric(metrics, "resting_hr_bpm")?.value;
  const stress = getLatestMetric(metrics, "stress")?.value;
  const sleep = calculateSleepScore(metrics);

  const hrvScore = hrv === undefined ? 50 : clamp((hrv / baselines.hrvMs) * 100);
  const restingHrScore =
    restingHr === undefined ? 50 : clamp(100 - Math.max(0, restingHr - baselines.restingHrBpm) * 5);
  const stressScore = stress === undefined ? 65 : clamp(100 - stress);

  const score = clamp(sleep.score * 0.35 + hrvScore * 0.35 + restingHrScore * 0.2 + stressScore * 0.1);

  return {
    score,
    signals: {
      sleep: sleep.score,
      hrv: hrvScore,
      restingHeartRate: restingHrScore,
      stress: stressScore
    }
  };
}

function calculateReadinessScore(recoveryScore, trainingLoad, muscleFatigue) {
  const workloadPenalty = Math.max(0, trainingLoad.acuteChronicWorkloadRatio - 1.2) * 22;
  const maxMuscleFatigue = Math.max(0, ...Object.values(muscleFatigue));
  const fatiguePenalty = maxMuscleFatigue * 0.22;

  return clamp(recoveryScore - workloadPenalty - fatiguePenalty);
}

function getAvailableMinutes(preferences) {
  const preference = preferences.find(
    (item) => item.category === "schedule" && item.key === "weekday_available_minutes"
  );
  return typeof preference?.value === "number" ? preference.value : 30;
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

function buildReasoning({ recovery, readinessScore, trainingLoad, muscleFatigue, restrictions, recommendedFocus }) {
  const reasoning = [
    `Recovery score is ${recovery.score}, with sleep ${recovery.signals.sleep}, HRV ${recovery.signals.hrv}, resting HR ${recovery.signals.restingHeartRate}, and stress ${recovery.signals.stress}.`,
    `Readiness score is ${readinessScore} after accounting for training load and recent muscle fatigue.`,
    `7-day training load is ${trainingLoad.trainingLoad7d}; 28-day training load is ${trainingLoad.trainingLoad28d}; acute/chronic ratio is ${trainingLoad.acuteChronicWorkloadRatio}.`
  ];

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
  const recovery = calculateRecoveryScore(context.healthMetrics, options.baselines);
  const readinessScore = calculateReadinessScore(recovery.score, trainingLoad, muscleFatigue);
  const restrictions = getActiveRestrictions(context.injuries, context.preferences);
  const recommendedFocus = chooseRecommendedFocus({
    readinessScore,
    muscleFatigue,
    restrictions,
    injuries: context.injuries,
    goals: [...context.goals]
  });

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
    confidence: context.healthMetrics.length >= 4 && context.workouts.length >= 2 ? "medium" : "low",
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
