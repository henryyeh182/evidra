import { generateSemanticFitnessState } from "../../../packages/semantic-engine/src/index.js";
import {
  generateTrainingPlan,
  previewPlanChange,
  createPlanStore
} from "../../../packages/planning/src/index.js";
import { loadDemoUserContext, loadExerciseCatalog } from "./demoData.js";
import { jsonContent } from "./content.js";

const DEFAULT_DATE = "2026-07-23";

// Process-lifetime store so preview -> commit and version history persist
// across tool calls. Swap for a PostgreSQL-backed repository later.
const planStore = createPlanStore();

function assertUserId(context, userId) {
  if (context.user.id !== userId) {
    throw new Error(`Unknown demo user: ${userId}`);
  }
}

export async function getSemanticFitnessState(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  const state = generateSemanticFitnessState(context, {
    date: args.date || DEFAULT_DATE,
    timezone: context.user.timezone
  });

  return jsonContent(state);
}

export async function recommendTodayWorkout(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  const state = generateSemanticFitnessState(context, {
    date: args.date || DEFAULT_DATE,
    timezone: context.user.timezone
  });

  return jsonContent({
    userId: state.userId,
    date: state.date,
    recommendedFocus: state.recommendedFocus,
    availableTimeMinutes: state.availableTimeMinutes,
    readinessScore: state.readinessScore,
    recoveryScore: state.recoveryScore,
    fatigueScore: state.fatigueScore,
    avoid: state.avoid,
    reasoning: state.reasoning,
    confidence: state.confidence
  });
}

export async function getTrainingContext(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  const exercises = await loadExerciseCatalog();

  return jsonContent({
    user: context.user,
    goals: context.goals,
    preferences: context.preferences,
    activeInjuries: context.injuries.filter((injury) => injury.status === "active"),
    availableEquipment: context.equipment.filter((equipment) => equipment.available),
    workoutCount: context.workouts.length,
    healthMetricCount: context.healthMetrics.length,
    exerciseCatalogCount: exercises.length,
    latestWorkout: [...context.workouts].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null
  });
}

export async function generateTrainingPlanTool(args = {}) {
  const context = await loadDemoUserContext();
  assertUserId(context, args.userId);

  const plan = generateTrainingPlan(context, {
    goalId: args.goalId,
    weeks: args.weeks,
    startDate: args.startDate
  });
  planStore.savePlan(plan);

  return jsonContent(plan);
}

export async function getTrainingPlanTool(args = {}) {
  const plan = planStore.getPlan(args.planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${args.planId}`);
  }

  return jsonContent({
    ...plan,
    versionHistory: planStore.getVersionHistory(plan.id)
  });
}

export async function listTrainingPlansTool(args = {}) {
  return jsonContent({
    userId: args.userId,
    plans: planStore.listPlans(args.userId)
  });
}

export async function previewPlanChangeTool(args = {}) {
  const plan = planStore.getPlan(args.planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${args.planId}`);
  }

  const preview = previewPlanChange(plan, args.changeRequest || {});
  planStore.savePreview(preview);

  return jsonContent({
    previewId: preview.previewId,
    planId: preview.planId,
    baseVersion: preview.baseVersion,
    summary: preview.summary,
    diff: preview.diff,
    note: "Call commit_plan_change with this previewId to apply the change."
  });
}

export async function commitPlanChangeTool(args = {}) {
  const committed = planStore.commitPreview(args.previewId);

  return jsonContent({
    planId: committed.id,
    version: committed.version,
    status: committed.status,
    versionHistory: planStore.getVersionHistory(committed.id),
    plan: committed
  });
}

export const toolHandlers = {
  get_semantic_fitness_state: getSemanticFitnessState,
  recommend_today_workout: recommendTodayWorkout,
  get_training_context: getTrainingContext,
  generate_training_plan: generateTrainingPlanTool,
  get_training_plan: getTrainingPlanTool,
  list_training_plans: listTrainingPlansTool,
  preview_plan_change: previewPlanChangeTool,
  commit_plan_change: commitPlanChangeTool
};
