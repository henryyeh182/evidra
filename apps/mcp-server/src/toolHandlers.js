import { generateSemanticFitnessState } from "../../../packages/semantic-engine/src/index.js";
import {
  generateTrainingPlan,
  previewPlanChange,
  createPlanStore
} from "../../../packages/planning/src/index.js";
import { loadDemoUserContext, loadExerciseCatalog } from "./demoData.js";
import { jsonContent } from "./content.js";
import { decideSession } from "../../../packages/decision-engine/src/index.js";
import {
  searchExercisesTool,
  getExerciseTool,
  searchWorkoutsTool,
  getWorkoutTool,
  getUserProfileTool,
  getTrainingHistoryTool
} from "./readToolHandlers.js";

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
  recommend_workout: recommendTodayWorkout,
  decide_session: decideSessionTool,
  get_training_context: getTrainingContext,
  search_exercises: searchExercisesTool,
  get_exercise: getExerciseTool,
  search_workouts: searchWorkoutsTool,
  get_workout: getWorkoutTool,
  get_user_profile: getUserProfileTool,
  get_training_history: getTrainingHistoryTool,
  generate_plan: generateTrainingPlanTool,
  get_plan: getTrainingPlanTool,
  list_plans: listTrainingPlansTool,
  preview_adjust_plan: previewPlanChangeTool,
  commit_adjust_plan: commitPlanChangeTool
};

/**
 * The product's core decision primitive: take today's scheduled session, weigh
 * it against today's evidence, and return what it should become (from -> to).
 *
 * Deliberately not a recommendation — if nothing is scheduled, it says so
 * rather than inventing a suggestion.
 */
export async function decideSessionTool(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  const date = args.date || DEFAULT_DATE;
  const state = generateSemanticFitnessState(context, {
    date,
    timezone: context.user.timezone
  });

  // Find the session scheduled for this date in the user's stored plan.
  let scheduledSession = null;
  let planId = args.planId || null;
  const plans = planId ? [planStore.getPlan(planId)].filter(Boolean) : planStore.listPlans(args.userId);
  for (const summary of plans) {
    const plan = planStore.getPlan(summary.id || summary);
    if (!plan) continue;
    for (const week of plan.weeks) {
      const match = week.sessions.find((session) => session.date === date);
      if (match) {
        scheduledSession = match;
        planId = plan.id;
        break;
      }
    }
    if (scheduledSession) break;
  }

  const decision = decideSession({
    scheduledSession,
    state,
    availableMinutes: args.availableMinutes
  });

  return jsonContent({ userId: context.user.id, date, planId, ...decision });
}
