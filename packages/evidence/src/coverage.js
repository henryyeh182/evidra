// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

const RECOVERY_SIGNALS = ["sleep_duration_hours", "sleep_quality", "hrv_ms", "resting_hr_bpm", "stress"];

export function getEvidenceCoverage(evidence = {}) {
  const metrics = evidence.healthMetrics || [];
  const assessments = evidence.vendorAssessments || [];
  const workouts = evidence.workouts || [];
  const available = new Set(metrics.map((metric) => metric.type));
  for (const assessment of assessments) available.add(assessment.type);

  const recoveryMissing = RECOVERY_SIGNALS.filter((signal) => !available.has(signal));
  const recoveryUsable = RECOVERY_SIGNALS.filter((signal) => available.has(signal));
  const trainingMissing = workouts.filter((workout) => workout.trainingLoad === undefined).length;
  const trainingUsable = workouts.length > 0 && trainingMissing === 0 ? ["training_load"] : [];
  const sources = new Set([
    ...metrics.map((metric) => metric.source).filter(Boolean),
    ...assessments.map((assessment) => assessment.source).filter(Boolean),
    ...workouts.map((workout) => workout.source).filter(Boolean)
  ]);
  const totalSignals = RECOVERY_SIGNALS.length + (workouts.length > 0 ? 1 : 0);
  const usableSignals = recoveryUsable.length + trainingUsable.length;
  const coverageScore = totalSignals === 0 ? 0 : Math.round((usableSignals / totalSignals) * 100);
  const qualityWarnings = [
    ...(metrics.some((metric) => !metric.basis) ? ["some health metrics have unstated basis"] : []),
    ...(assessments.some((assessment) => !assessment.basis) ? ["some vendor assessments have unstated basis"] : []),
    ...(workouts.length > 0 && trainingMissing > 0 ? [`${trainingMissing} workout(s) have no training load`] : [])
  ];
  const quality = qualityWarnings.length === 0 && sources.size > 0 ? "high" : sources.size > 0 ? "medium" : "low";

  return {
    coverageScore,
    quality,
    qualityWarnings,
    coverage: {
      recovery: { usable: recoveryUsable, missing: recoveryMissing },
      training: { usable: trainingUsable, missing: trainingMissing > 0 ? ["training_load"] : [] }
    },
    sources: [...sources].sort(),
    missing: [...recoveryMissing, ...(trainingMissing > 0 ? ["training_load"] : [])]
  };
}
