// `source` names the vendor an export came from; `metadata` is where a
// connector records what it learned reading it — which device actually wrote a
// reading, how a day was aggregated, where a session's load came from. These
// conversions used to list their fields and leave metadata off the list, so all
// of that died at this boundary and nothing downstream could ever have known
// it. Apple Health is the case that makes it matter: it is a destination as
// much as a source, so "this came from Apple Health" says nothing about whether
// an Apple Watch measured it or another vendor synced it in.

export function normalizedWorkoutToWorkout(event) {
  if (event.kind !== "workout") {
    throw new Error(`Expected workout event, received ${event.kind}.`);
  }

  return {
    id: event.id,
    type: event.type,
    name: event.name,
    startedAt: event.startedAt,
    durationMinutes: event.durationMinutes,
    rpe: event.rpe,
    trainingLoad: event.trainingLoad,
    muscleGroups: event.muscleGroups,
    source: event.source,
    sourceRecordId: event.sourceRecordId,
    ...(event.metadata ? { metadata: event.metadata } : {})
  };
}

export function normalizedHealthMetricToHealthMetric(event) {
  if (event.kind !== "health_metric") {
    throw new Error(`Expected health metric event, received ${event.kind}.`);
  }

  return {
    id: event.id,
    type: event.type,
    value: event.value,
    unit: event.unit,
    recordedAt: event.recordedAt,
    source: event.source,
    sourceRecordId: event.sourceRecordId,
    confidence: event.confidence,
    ...(event.metadata ? { metadata: event.metadata } : {})
  };
}

export function applyNormalizedEventsToContext(context, events) {
  const workouts = [...context.workouts];
  const healthMetrics = [...context.healthMetrics];

  for (const event of events) {
    if (event.kind === "workout") {
      const workout = normalizedWorkoutToWorkout(event);
      const existingIndex = workouts.findIndex((item) => item.id === workout.id);
      if (existingIndex >= 0) {
        workouts[existingIndex] = workout;
      } else {
        workouts.push(workout);
      }
    }

    if (event.kind === "health_metric") {
      const metric = normalizedHealthMetricToHealthMetric(event);
      const existingIndex = healthMetrics.findIndex((item) => item.id === metric.id);
      if (existingIndex >= 0) {
        healthMetrics[existingIndex] = metric;
      } else {
        healthMetrics.push(metric);
      }
    }
  }

  return {
    ...context,
    workouts: workouts.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt)),
    healthMetrics: healthMetrics.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
  };
}
