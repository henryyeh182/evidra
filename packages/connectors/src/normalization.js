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
    sourceRecordId: event.sourceRecordId
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
    confidence: event.confidence
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
