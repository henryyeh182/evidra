import { generateSemanticFitnessState } from "../../../packages/semantic-engine/src/index.js";
import {
  generateTrainingPlan,
  previewPlanChange,
  createPlanStore
} from "../../../packages/planning/src/index.js";
import { loadDemoUserContext, loadExerciseCatalog, latestEvidenceDay } from "./demoData.js";
import { loadKnowledgeBase } from "./knowledgeBase.js";
import { jsonContent } from "./content.js";
import { decideSession } from "../../../packages/decision-engine/src/index.js";
import {
  computeTrainingLoad,
  computePersonalBaselines
} from "../../../packages/training-load/src/index.js";
import {
  evidenceToUserContext,
  describeEvidence
} from "../../../packages/evidence/src/index.js";
import { todayInTimezone } from "../../../packages/domain/src/dates.js";
import {
  searchExercisesTool,
  getExerciseTool,
  searchWorkoutsTool,
  getWorkoutTool,
  getUserProfileTool,
  getTrainingHistoryTool,
  decideExerciseSubstitutionTool
} from "./readToolHandlers.js";

// Process-lifetime store so preview -> commit and version history persist
// across tool calls. Swap for a PostgreSQL-backed repository later.
const planStore = createPlanStore();

function assertUserId(context, userId) {
  if (context.user.id !== userId) {
    throw new Error(`Unknown demo user: ${userId}`);
  }
}

/**
 * Resolve the context a call should reason over.
 *
 * The architecture has the AI layer hold the user's authorization and pass
 * evidence in as tool arguments, so inbound `evidence` always wins and nothing
 * is persisted. The demo seed remains only as a fallback for local runs, and
 * the caller is told which one was used rather than left to assume.
 *
 * Also resolves the day a call reasons about when the caller omits `date` — the
 * server owns that (P5), and it is a calendar day in the user's timezone, never
 * a UTC instant and never a literal frozen into this file.
 */
async function resolveContext(args) {
  if (args.evidence) {
    const context = evidenceToUserContext(args.evidence, { userId: args.userId });
    return {
      context,
      defaultDate: todayInTimezone(context.user.timezone),
      provenance: { evidenceSource: "provided", ...describeEvidence(args.evidence) }
    };
  }
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  // The seed is a snapshot; answering it against the real calendar would only
  // measure how long ago it was written.
  const seedDay = latestEvidenceDay(context);
  return {
    context,
    defaultDate: seedDay || todayInTimezone(context.user.timezone),
    provenance: {
      evidenceSource: "demo_fallback",
      note: "No evidence was supplied; used the local demo seed. Production callers must pass evidence.",
      ...(seedDay ? { dateAnchoredTo: seedDay, dateAnchorReason: "most recent day in the demo seed" } : {})
    }
  };
}

export async function getSemanticFitnessState(args = {}) {
  const { context, provenance, defaultDate } = await resolveContext(args);

  const date = args.date || defaultDate;
  const state = generateSemanticFitnessState(context, { date, timezone: context.user.timezone });

  // Impulse-response load curves and personal baselines, computed from the
  // supplied evidence. Returned so the caller can remember and re-inspect them;
  // nothing is retained here.
  const trainingLoad = computeTrainingLoad(context.workouts, { asOf: date });
  const { baselines } = computePersonalBaselines(context.healthMetrics, { asOf: date });

  return jsonContent({
    ...state,
    trainingLoad: {
      ctl: trainingLoad.ctl,
      atl: trainingLoad.atl,
      tsb: trainingLoad.tsb,
      acwr: trainingLoad.acwr,
      zone: trainingLoad.zone,
      zoneNote: trainingLoad.zoneNote,
      // Structured, not just prose in zoneNote: the agent has to be able to act
      // on "62 days off, chronic load down 78%" without parsing a sentence.
      detraining: trainingLoad.detraining,
      coverage: trainingLoad.coverage
    },
    baselines,
    provenance
  });
}

export async function recommendTodayWorkout(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  // Deprecated, and demo-seed only: anchor to the seed's own latest day.
  const state = generateSemanticFitnessState(context, {
    date: args.date || latestEvidenceDay(context) || todayInTimezone(context.user.timezone),
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

/**
 * The naming boundary. Inside this server everything is a canonical
 * `exercise_*` id; the graph is the only thing that knows how those are spoken,
 * and the only thing that can turn however a caller phrased it back into an id.
 */
async function exerciseNaming() {
  const { graph } = await loadKnowledgeBase();
  return {
    displayNameFor: (id) => graph.displayNameFor(id),
    // Free text in, canonical id out. Anything that does not resolve is left
    // untouched rather than dropped, so an unknown movement stays visible in
    // the decision instead of silently disappearing from the session.
    toCanonicalIds: (values = []) =>
      values.map((value) => graph.resolveExercise(value)?.id ?? value)
  };
}

export async function generateTrainingPlanTool(args = {}) {
  const { context } = await resolveContext(args);
  const { displayNameFor } = await exerciseNaming();

  const plan = generateTrainingPlan(context, {
    goalId: args.goalId,
    weeks: args.weeks,
    startDate: args.startDate,
    displayNameFor
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
  assess_fitness_state: getSemanticFitnessState,
  recommend_workout: recommendTodayWorkout,
  decide_session: decideSessionTool,
  decide_exercise_substitution: decideExerciseSubstitutionTool,
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
  const { context, provenance, defaultDate } = await resolveContext(args);

  const date = args.date || defaultDate;
  const state = generateSemanticFitnessState(context, {
    date,
    timezone: context.user.timezone
  });

  // The caller supplies what was scheduled. The AI agent is the one holding the
  // user's memory — the knee injury, last week's leg day, yesterday's tabata —
  // so it passes today's session in rather than us keeping a copy of the plan.
  let scheduledSession = args.scheduledSession || null;
  let planId = args.planId || null;

  if (!scheduledSession) {
    // Local demo fallback only: look in the process-lifetime plan store.
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
  }

  const trainingLoad = computeTrainingLoad(context.workouts, { asOf: date });

  // Agents describe the session the way their user does ("bent-over row",
  // "easy walk"). Normalize to canonical ids here so the decision engine never
  // has to reason about spelling, and so what comes back can be looked up.
  const { displayNameFor, toCanonicalIds } = await exerciseNaming();
  if (scheduledSession) {
    scheduledSession = {
      ...scheduledSession,
      exerciseIds: toCanonicalIds(scheduledSession.exerciseIds || scheduledSession.exercises || [])
    };
  }

  const decision = decideSession({
    scheduledSession,
    displayNameFor,
    // The impulse-response ACWR supersedes the crude 7d/28d ratio when the
    // history is long enough to have converged.
    state: trainingLoad.coverage.sufficient
      ? { ...state, acuteChronicWorkloadRatio: trainingLoad.acwr, trainingLoad }
      : { ...state, trainingLoad },
    availableMinutes: args.availableMinutes
  });

  return jsonContent({
    userId: context.user.id,
    date,
    planId,
    ...decision,
    provenance: {
      ...provenance,
      scheduledSessionSource: args.scheduledSession ? "provided" : "demo_plan_store"
    }
  });
}
