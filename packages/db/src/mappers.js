import { stableId } from "./id.js";

export function mapUserToRow(user) {
  return {
    id: user.id,
    name: user.name,
    timezone: user.timezone,
    height_cm: user.heightCm,
    weight_kg: user.weightKg,
    fitness_level: user.fitnessLevel
  };
}

export function mapGoalToRow(userId, goal) {
  return {
    id: goal.id,
    user_id: userId,
    type: goal.type,
    label: goal.label,
    priority: goal.priority,
    target_date: goal.targetDate || null,
    status: goal.status || "active"
  };
}

export function mapPreferenceToRow(userId, preference) {
  return {
    id: stableId(userId, "preference", preference.category, preference.key),
    user_id: userId,
    category: preference.category,
    key: preference.key,
    value: preference.value,
    strength: preference.strength
  };
}

export function mapInjuryToRow(userId, injury) {
  return {
    id: injury.id,
    user_id: userId,
    body_region: injury.bodyRegion,
    severity: injury.severity,
    restrictions: injury.restrictions,
    status: injury.status
  };
}

export function mapEquipmentToRow(userId, equipment) {
  return {
    id: stableId(userId, "equipment", equipment.type, equipment.location),
    user_id: userId,
    type: equipment.type,
    location: equipment.location,
    available: equipment.available
  };
}

export function mapWorkoutToRow(userId, workout) {
  return {
    id: workout.id,
    user_id: userId,
    type: workout.type,
    name: workout.name,
    started_at: workout.startedAt,
    duration_minutes: workout.durationMinutes,
    rpe: workout.rpe,
    training_load: workout.trainingLoad,
    muscle_groups: workout.muscleGroups,
    source: workout.source,
    source_record_id: workout.sourceRecordId || null
  };
}

export function mapHealthMetricToRow(userId, metric) {
  return {
    id: metric.id || stableId(userId, metric.source, metric.type, metric.recordedAt),
    user_id: userId,
    type: metric.type,
    value: metric.value,
    unit: metric.unit,
    recorded_at: metric.recordedAt,
    source: metric.source,
    source_record_id: metric.sourceRecordId || null,
    confidence: metric.confidence ?? 1
  };
}

export function mapSemanticStateToRow(state) {
  return {
    id: stableId(state.userId, "semantic_state", state.date),
    user_id: state.userId,
    state_date: state.date,
    timezone: state.timezone,
    recovery_score: state.recoveryScore,
    readiness_score: state.readinessScore,
    fatigue_score: state.fatigueScore,
    sleep_quality: state.sleepQuality,
    training_load_7d: state.trainingLoad7d,
    training_load_28d: state.trainingLoad28d,
    acute_chronic_workload_ratio: state.acuteChronicWorkloadRatio,
    muscle_fatigue: state.muscleFatigue,
    recommended_focus: state.recommendedFocus,
    avoid: state.avoid,
    available_time_minutes: state.availableTimeMinutes,
    goal_alignment: state.goalAlignment,
    confidence: state.confidence,
    reasoning: state.reasoning
  };
}

export function mapUserContextToRows(context) {
  const userId = context.user.id;

  return {
    users: [mapUserToRow(context.user)],
    goals: context.goals.map((goal) => mapGoalToRow(userId, goal)),
    preferences: context.preferences.map((preference) => mapPreferenceToRow(userId, preference)),
    injuries: context.injuries.map((injury) => mapInjuryToRow(userId, injury)),
    equipment: context.equipment.map((equipment) => mapEquipmentToRow(userId, equipment)),
    workouts: context.workouts.map((workout) => mapWorkoutToRow(userId, workout)),
    health_metrics: context.healthMetrics.map((metric) => mapHealthMetricToRow(userId, metric))
  };
}
