// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidUserContext } from "../../domain/src/models.js";
import { PARAMETERS, assertParametersMatch, getParameter } from "../../rules/src/index.js";
import {
  EVIDENCE_METRIC_TYPES,
  EVIDENCE_VENDOR_ASSESSMENT_TYPES
} from "../../evidence/src/model.js";

// Every number in this block comes from
// `packages/rules/data/engine-parameters.json`, not from here. None of them
// belong to a rule and none appear in any `decisionBasis`, and they change what
// the engine decides all the same: the baselines sit underneath a readiness
// score that three rules cut, and a staleness window decides whether a signal
// is usable or missing at all. As literals here there was nowhere to say who
// chose them or on what — which is the thing the rule library exists to stop.
const PARAMETER_KEYS = [
  "baselineHrvMs",
  "baselineRestingHrBpm",
  "baselineWeeklyTrainingLoad",
  "stalenessSleepDays",
  "stalenessAutonomicDays",
  "stalenessRestingHrDays",
  "stalenessVendorCompositeDays"
];
assertParametersMatch("packages/semantic-engine/src/generateSemanticFitnessState.js", PARAMETER_KEYS);

const DEFAULT_BASELINES = {
  hrvMs: PARAMETERS.baselineHrvMs,
  restingHrBpm: PARAMETERS.baselineRestingHrBpm,
  weeklyTrainingLoadTarget: PARAMETERS.baselineWeeklyTrainingLoad
};

// A recovery signal only counts if its latest reading is recent enough to
// describe *today*. Sparse wearers (e.g. no watch overnight) otherwise get a
// years-old HRV/sleep reading treated as current. Stale signals are dropped and
// the remaining weights are renormalized, so the score reflects what we can
// actually observe instead of neutral filler.
//
// Built from the parameter set rather than written here, so which signals share
// a window is data too: sleep's three days and the vendor composites' two are
// separate decisions, and grouping them by hand in an object literal made them
// look like one.
//
// Each `appliesTo` entry is checked against the evidence model's own type
// names, because this is the one place where moving a number into data made a
// new mistake possible: `hrv` for `hrv_ms` would not fail any parameter check,
// and `getFreshMetricValue` would compare an age against `undefined`, drop
// every HRV reading, and report it as a signal nobody supplied.
const SIGNAL_STALENESS_DAYS = buildStalenessWindows();

function buildStalenessWindows() {
  const known = new Set([...EVIDENCE_METRIC_TYPES, ...EVIDENCE_VENDOR_ASSESSMENT_TYPES]);
  const windows = {};

  for (const key of PARAMETER_KEYS) {
    const parameter = getParameter(key);
    if (parameter.group !== "signal_staleness") continue;

    if (!Array.isArray(parameter.appliesTo) || parameter.appliesTo.length === 0) {
      throw new Error(`${parameter.parameterId} is a staleness window that applies to nothing.`);
    }
    for (const type of parameter.appliesTo) {
      if (!known.has(type)) {
        throw new Error(
          `${parameter.parameterId} declares a staleness window for "${type}", which is not an ` +
            `evidence metric or vendor assessment type.`
        );
      }
      if (type in windows) {
        throw new Error(`Two staleness windows are declared for "${type}".`);
      }
      windows[type] = parameter.value;
    }
  }

  return Object.freeze(windows);
}

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

// The chronic half of the acute:chronic ratio looks back this far. Named rather
// than inlined because the coverage caveat below is derived from it, so the two
// cannot drift apart.
const CHRONIC_WINDOW_DAYS = 28;

function calculateTrainingLoad(workouts, anchorDate, baselines = DEFAULT_BASELINES) {
  const recent7d = workoutsWithinDays(workouts, anchorDate, 7);
  const recent28d = workoutsWithinDays(workouts, anchorDate, CHRONIC_WINDOW_DAYS);
  // A session without a load adds nothing to the sum — it cannot, nobody
  // measured it. The gap is reported through `signalCoverage.training` rather
  // than smuggled into the total as a number.
  const sumLoad = (sum, workout) =>
    typeof workout.trainingLoad === "number" ? sum + workout.trainingLoad : sum;
  const load7d = recent7d.reduce(sumLoad, 0);
  const load28d = recent28d.reduce(sumLoad, 0);
  const observedChronicWeeklyLoad = load28d / 4 || 0;
  const chronicWeeklyLoad = Math.max(observedChronicWeeklyLoad, baselines.weeklyTrainingLoadTarget);

  // How far back the supplied evidence actually reaches inside the chronic
  // window. A 28-day denominator built from one session is not a 28-day
  // denominator, and the ratio it produces is an artefact of thin data rather
  // than a reading about this person — observed in the field as an ACWR of 0.17
  // that a caller had to talk its own user out of believing.
  //
  // Half the window is the same rule `packages/training-load/src/trainingLoad.js`
  // already applies to its CTL curve, kept identical so there is one threshold
  // with one rationale instead of two magic numbers.
  const oldest = recent28d.reduce((earliest, workout) => {
    const startedAt = new Date(workout.startedAt);
    return !earliest || startedAt < earliest ? startedAt : earliest;
  }, null);
  const historyDays = oldest
    ? Math.min(CHRONIC_WINDOW_DAYS, Math.round(daysBetween(anchorDate, oldest)))
    : 0;
  const sufficientHistory = historyDays >= CHRONIC_WINDOW_DAYS * 0.5;

  // When observed load loses to the baseline floor, the ratio is no longer this
  // person's acute load against their own chronic load — it is their acute load
  // against a target. Worth saying out loud, because the number still looks like
  // an ACWR.
  const chronicBasis =
    observedChronicWeeklyLoad >= baselines.weeklyTrainingLoadTarget ? "observed" : "baseline_floor";

  return {
    trainingLoad7d: load7d,
    trainingLoad28d: load28d,
    acuteChronicWorkloadRatio: Number((load7d / chronicWeeklyLoad).toFixed(2)),
    coverage: {
      chronicWindowDays: CHRONIC_WINDOW_DAYS,
      historyDays,
      sessionsInWindow: recent28d.length,
      sufficientHistory,
      chronicBasis
    }
  };
}

// Muscle fatigue, plus an account of what it could not read. A session skipped
// for want of a load leaves a muscle group looking rested when nobody measured
// it, so the skip has to travel with the number rather than disappear.
//
// The session's training load is taken as it stands and not scaled again. It
// already carries the session's intensity — Garmin's activityTrainingLoad,
// Strava's Relative Effort, Apple Health's active energy are each the vendor's
// own effort figure, and `trainingLoad.js` spends the same number raw when it
// builds ATL, CTL and the acute:chronic ratio. Multiplying it here by an
// RPE-derived factor both double-counted intensity and made fatigue impossible
// to compute for any source that reports no RPE, which is most of them.
//
// RPE is still collected as evidence; it is simply not a term in this sum.
function calculateMuscleFatigue(workouts, anchorDate) {
  const fatigue = {};
  const window = workoutsWithinDays(workouts, anchorDate, 7);
  let skipped = 0;

  for (const workout of window) {
    const ageDays = daysBetween(anchorDate, new Date(workout.startedAt));
    const decay = Math.max(0.15, 1 - ageDays / 5);
    // No load, no fatigue contribution. Skipped rather than counted as zero:
    // zero is a claim that the session cost nothing, and nobody said that.
    if (typeof workout.trainingLoad !== "number") {
      skipped += 1;
      continue;
    }
    const fatigueContribution = workout.trainingLoad * decay;

    for (const muscleGroup of workout.muscleGroups) {
      fatigue[muscleGroup] = (fatigue[muscleGroup] || 0) + fatigueContribution;
    }
  }

  return {
    fatigue: Object.fromEntries(
      Object.entries(fatigue).map(([muscleGroup, value]) => [muscleGroup, clamp(value)])
    ),
    coverage: buildTrainingCoverage(window),
    skipped,
    considered: window.length
  };
}

// Training-side coverage, deliberately strict: a signal counts as usable only
// when every session in the window carries it. One session without a load is
// enough to make the muscle-fatigue picture incomplete, and a caller reading
// `usable` should not have to guess whether it meant "all" or "some".
//
// Only `trainingLoad` appears here, because only `trainingLoad` is read. RPE is
// carried as evidence but no longer enters any sum, and reporting a gap that
// changes no number would just make well-served sources look deficient.
function buildTrainingCoverage(window) {
  if (window.length === 0) {
    // No sessions is not a missing signal — there was nothing to report.
    return { usable: [], missing: [] };
  }

  const complete = window.every((workout) => typeof workout.trainingLoad === "number");
  return complete ? { usable: ["trainingLoad"], missing: [] } : { usable: [], missing: ["trainingLoad"] };
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
    // No fresh recovery signal at all. This used to return 50 — a neutral score
    // that read as a measurement all the way downstream: readiness came out 50,
    // the rule that cuts intensity below 60 fired on it, and the athlete was
    // told "readiness 50 is below 60, so intensity comes down" about a number
    // nobody had supplied. Coverage reported the gap faithfully the whole time,
    // and it made no difference, because the decision had already been made on
    // the invented value.
    //
    // null is the honest answer, and it is what stops the readiness rules from
    // firing at all.
    return { score: null, signals, coverage: { usable, missing } };
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = clamp(parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight);

  return { score, signals, coverage: { usable, missing } };
}

function calculateReadinessScore(recoveryScore, trainingLoad, muscleFatigue) {
  // Readiness is recovery with penalties applied. With no recovery reading there
  // is nothing to apply them to, and a number derived from nothing would be
  // indistinguishable from a measured one.
  if (recoveryScore === null) return null;
  const workloadPenalty = Math.max(0, trainingLoad.acuteChronicWorkloadRatio - 1.2) * 22;
  const maxMuscleFatigue = Math.max(0, ...Object.values(muscleFatigue));
  const fatiguePenalty = maxMuscleFatigue * 0.22;

  return clamp(recoveryScore - workloadPenalty - fatiguePenalty);
}

// null means "the user never told us", which is not the same as a short day.
// This used to default to 30, and downstream had no way to tell the invented
// number from a stated one — evidra_decide_session cut a 60-minute session in half and
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

  // `null < 45` is true in JavaScript, so an unmeasured readiness used to steer
  // straight into the recovery-walk branch. Absent readiness steers nothing.
  if (readinessScore !== null && readinessScore < 45) {
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
function assessConfidence(coverage, trainingCoverage, recentWorkoutCount) {
  const hasHrv = coverage.usable.includes("hrv");
  const hasSleep = coverage.usable.includes("sleep");
  const hasVendorComposite =
    coverage.usable.includes("vendorReadiness") || coverage.usable.includes("bodyBattery");
  // Not an empirical threshold: with a session left out of muscle fatigue, part
  // of the picture is simply unread, and "high" would be claiming otherwise.
  const trainingIncomplete = trainingCoverage.missing.length > 0;

  if (!trainingIncomplete && hasVendorComposite && coverage.usable.length >= 2 && recentWorkoutCount >= 1) {
    // The device maker already integrated the signals we cannot see.
    return "high";
  }
  if (!trainingIncomplete && hasHrv && hasSleep && coverage.usable.length >= 3 && recentWorkoutCount >= 2) {
    return "high";
  }
  if (coverage.usable.length >= 2 && recentWorkoutCount >= 1) {
    return "medium";
  }
  return "low";
}

function buildReasoning({ recovery, training, readinessScore, trainingLoad, muscleFatigue, restrictions, recommendedFocus }) {
  const usableSignals = recovery.coverage.usable
    .map((name) => `${name} ${recovery.signals[name]}`)
    .join(", ");
  const reasoning = [
    usableSignals
      ? `Recovery score is ${recovery.score}, based on ${usableSignals}.`
      : `No fresh recovery signal is available, so there is no recovery score today — nothing is assumed in its place.`,
    readinessScore === null
      ? `Readiness is not scored without a recovery reading, so nothing today was decided on how recovered you are.`
      : `Readiness score is ${readinessScore} after accounting for training load and recent muscle fatigue.`,
    `7-day training load is ${trainingLoad.trainingLoad7d}; 28-day training load is ${trainingLoad.trainingLoad28d}; acute/chronic ratio is ${trainingLoad.acuteChronicWorkloadRatio}.`
  ];

  if (recovery.coverage.missing.length > 0) {
    reasoning.push(`No fresh reading for: ${recovery.coverage.missing.join(", ")}; those signals were excluded and confidence lowered.`);
  }

  if (training.skipped > 0) {
    reasoning.push(
      `${training.skipped} of ${training.considered} sessions in the last 7 days carry no training load, ` +
        `so they are absent from muscle fatigue — the groups they would have loaded read lower than they were trained.`
    );
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
  const training = calculateMuscleFatigue(context.workouts, anchorDate);
  const muscleFatigue = training.fatigue;
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
    fatigueScore: readinessScore === null ? null : clamp(100 - readinessScore),
    sleepQuality: recovery.signals.sleep,
    trainingLoad7d: trainingLoad.trainingLoad7d,
    trainingLoad28d: trainingLoad.trainingLoad28d,
    acuteChronicWorkloadRatio: trainingLoad.acuteChronicWorkloadRatio,
    // Travels with the ratio, never separately: whoever reads the number has to
    // be able to see how much evidence is standing behind it.
    acwrCoverage: trainingLoad.coverage,
    muscleFatigue,
    recommendedFocus,
    avoid: restrictions,
    availableTimeMinutes: getAvailableMinutes(context.preferences),
    goalAlignment: {
      primaryGoal: context.goals.sort((a, b) => a.priority - b.priority)[0]?.type || "general_fitness",
      score: readinessScore === null ? null : readinessScore >= 55 ? 0.76 : 0.52
    },
    // Two groups, not one list: a missing HRV and a session without an RPE are
    // both gaps, but they are gaps in different halves of the picture and a
    // caller has to be able to tell which half it is looking at.
    signalCoverage: {
      recovery: recovery.coverage,
      training: training.coverage
    },
    confidence: assessConfidence(recovery.coverage, training.coverage, recentWorkoutCount),
    reasoning: buildReasoning({
      recovery,
      training,
      readinessScore,
      trainingLoad,
      muscleFatigue,
      restrictions,
      recommendedFocus
    })
  };
}
