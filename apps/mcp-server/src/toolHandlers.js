// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { generateSemanticFitnessState } from "../../../packages/semantic-engine/src/index.js";
import {
  generateTrainingPlan,
  previewPlanChange,
  applyPlanPreview,
  buildVersionHistory,
  summarizePlan
} from "../../../packages/planning/src/index.js";
import { loadDemoUserContext, loadExerciseCatalog, latestEvidenceDay } from "./demoData.js";
import { loadKnowledgeBase } from "./knowledgeBase.js";
import { jsonContent, errorContent } from "./content.js";
import { decideSession } from "../../../packages/decision-engine/src/index.js";
import {
  computeTrainingLoad,
  computePersonalBaselines
} from "../../../packages/training-load/src/index.js";
import {
  evidenceToUserContext,
  describeEvidence,
  EVIDENCE_METRIC_TYPES,
  EVIDENCE_VENDOR_ASSESSMENT_TYPES
} from "../../../packages/evidence/src/index.js";
import { isCalendarDay, todayInTimezone } from "../../../packages/domain/src/dates.js";
import {
  searchExercisesTool,
  getExerciseTool,
  searchWorkoutsTool,
  getWorkoutTool,
  getUserProfileTool,
  getTrainingHistoryTool,
  decideExerciseSubstitutionTool
} from "./readToolHandlers.js";

/**
 * What a caller has to send before any of this can compute anything.
 *
 * Listed rather than described so the answer to "what do I do now" is machine
 * readable: a host that reads this knows which connectors to go and ask.
 */
const EVIDENCE_REQUIREMENTS = {
  required: ["evidence"],
  accepts: {
    "evidence.healthMetrics":
      "Recent readings — sleep_duration_hours, sleep_quality, hrv_ms, resting_hr_bpm, stress — each with value, recordedAt, source.",
    "evidence.workouts":
      "Completed sessions from the last 7-28 days with startedAt, durationMinutes, type, trainingLoad, muscleGroups.",
    "evidence.profile": "timezone, fitnessLevel.",
    "evidence.constraints": "injuries[], equipment[], availableMinutes, avoidMovements[]."
  },
  note:
    "Any single source decides something: training load alone, recovery signals alone, or what the athlete tells you. Whatever is absent is reported in signalCoverage and lowers confidence, so a thin call still returns a decision that says how thin it is."
};

/**
 * Resolve the context a call should reason over.
 *
 * The architecture has the AI layer hold the user's authorization and pass
 * evidence in as tool arguments, so `evidence` is the only production input and
 * nothing is persisted. Returns null when there is nothing to reason over; the
 * caller turns that into an answer rather than an exception, because "you have
 * not sent me anything yet" is a state of the conversation, not a fault.
 *
 * The demo seed is reachable only by asking for it outright (`useDemoSeed`),
 * and that flag is deliberately absent from the public tool schemas: seed data
 * is another person's numbers, and it must not be able to reach a real user's
 * answer by way of a silent fallback.
 *
 * Also resolves the day a call reasons about when the caller omits `date` — the
 * server owns that (P5), and it is a calendar day in the user's timezone, never
 * a UTC instant and never a literal frozen into this file.
 */
async function resolveContext(args) {
  if (args.evidence) {
    let context;
    let defaultDate;
    try {
      context = evidenceToUserContext(args.evidence, { userId: args.userId });
      // Resolving the day belongs inside the guard: `profile.timezone` is a
      // caller-supplied string, and an unreadable zone ("Taipei", "GMT+8"
      // instead of "Asia/Taipei") threw from here as a bare JSON-RPC error —
      // the same "Failed to call tool" dead end, over a field the caller could
      // have fixed in one turn.
      defaultDate = todayInTimezone(context.user.timezone);
    } catch (error) {
      // Evidence that arrived in the wrong shape is the same kind of failure as
      // evidence that never arrived: the tool ran and cannot answer. Thrown as a
      // JSON-RPC error it reads as "Failed to call tool" and the caller gives up
      // — observed doing exactly that. Handed back with the shape it should have
      // had, a caller can fix its payload and try again in the same turn.
      return { invalid: error.message };
    }
    return {
      context,
      defaultDate,
      provenance: { evidenceSource: "provided", ...describeEvidence(args.evidence) }
    };
  }

  if (!args.useDemoSeed) {
    return null;
  }

  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });

  // The seed is a snapshot; answering it against the real calendar would only
  // measure how long ago it was written.
  const seedDay = latestEvidenceDay(context);
  return {
    context,
    defaultDate: seedDay || todayInTimezone(context.user.timezone),
    provenance: {
      evidenceSource: "demo_seed",
      note: "Local demo seed, requested explicitly. Not a real user; never returned to production callers.",
      ...(seedDay ? { dateAnchoredTo: seedDay, dateAnchorReason: "most recent day in the demo seed" } : {})
    }
  };
}

/**
 * The answer when a caller sent no evidence: not a decision, and honest about
 * why there isn't one.
 */
function evidenceRequired(toolName) {
  return errorContent({
    error: "evidence_required",
    tool: toolName,
    problem: "This call arrived without evidence, so there is nothing to compute yet. It is the first step, not a failure.",
    // What used to sit here was a statement of what this server will not do.
    // Read aloud it becomes an apology, and that is what reached the athlete.
    // The way out has to travel with the refusal, phrased as the caller's next
    // move rather than as our architecture.
    callerAction:
      "Get the evidence, then call again. Read it from whichever health connectors this user has; where there are none, ask them — what a person says about their own week is evidence, and three questions usually cover it: how long they slept last night, how their legs feel right now, when their last hard session was. Their answers are the input: 'about seven hours' is sleep_duration_hours 7, 'ran 45 minutes on Tuesday' is a workout. Deciding on what the athlete can tell you is the designed path, not a fallback — say nothing to them about missing data until you have asked.",
    ...EVIDENCE_REQUIREMENTS
  });
}

/**
 * The answer when evidence arrived but not in a shape this server can read.
 * Says which rule was broken and what the shape is, so the next attempt can be
 * right rather than being another guess.
 */
function invalidEvidence(toolName, problem) {
  return errorContent({
    error: "invalid_evidence",
    tool: toolName,
    problem,
    shape: {
      "evidence.profile": {
        timezone: "optional IANA zone name, e.g. Asia/Taipei — not an abbreviation or offset. Defaults to UTC.",
        fitnessLevel: "optional, e.g. beginner | intermediate | advanced"
      },
      "evidence.healthMetrics[]": {
        type: `one of: ${EVIDENCE_METRIC_TYPES.join(", ")}`,
        value: "number",
        recordedAt: "ISO 8601 timestamp",
        source: "optional, e.g. garmin | strava | apple_health"
      },
      "evidence.vendorAssessments[]": {
        type: `one of: ${EVIDENCE_VENDOR_ASSESSMENT_TYPES.join(", ")}`,
        value: "number, as the vendor reports it",
        recordedAt: "ISO 8601 timestamp",
        source: "optional, e.g. garmin | oura | whoop"
      },
      "evidence.workouts[]": {
        startedAt: "ISO 8601 timestamp — required",
        durationMinutes: "number — required",
        type: "optional, e.g. run | strength | recovery",
        trainingLoad: "optional; the vendor's own effort figure, used as it stands",
        muscleGroups: "optional string array"
      }
    },
    note:
      "Metric names are canonical and case-sensitive: sleepDurationHours is not sleep_duration_hours. A vendor composite (Body Battery, Oura or Whoop readiness) belongs in vendorAssessments, not healthMetrics, and is worth sending — the recovery score weights it above the raw signals. Send what you actually have; omitted signals come back reported as missing."
  });
}

/**
 * The answer when a day argument is not a day this system can read.
 *
 * Agents write dates the way their user says them. "today" and "2026-8-1"
 * reached the load curve and threw `Invalid time value`, which the host showed
 * as "Failed to call tool" — fatal, for an argument the caller could have
 * corrected immediately had anyone told it the format.
 */
function invalidDate(toolName, argument, value) {
  return errorContent({
    error: "invalid_date",
    tool: toolName,
    problem: `${argument} was ${JSON.stringify(value)}, which is not a calendar day.`,
    shape: { [argument]: "YYYY-MM-DD, e.g. 2026-08-01" },
    callerAction:
      "Resolve the relative word yourself and send a calendar day, or drop the argument entirely — omitted, it resolves to today in the athlete's timezone here."
  });
}

export async function getSemanticFitnessState(args = {}) {
  // Falsy mirrors `args.date || defaultDate` below: an absent or empty date
  // still means "the server works today out", exactly as before.
  if (args.date && !isCalendarDay(args.date)) {
    return invalidDate("evidra_assess_fitness_state", "date", args.date);
  }
  const resolved = await resolveContext(args);
  if (!resolved) return evidenceRequired("evidra_assess_fitness_state");
  if (resolved.invalid) return invalidEvidence("evidra_assess_fitness_state", resolved.invalid);
  const { context, provenance, defaultDate } = resolved;

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

/**
 * The catalog lookup a plan uses when a slot's prescribed movements are all
 * unavailable: something else that trains the same quality, under the same
 * equipment and injury constraints. Returns an id or null — the planner decides
 * what to do with "nothing fits", and says so in the session rationale either
 * way.
 */
async function goalAlternativeLookup() {
  const { graph } = await loadKnowledgeBase();

  return ({ trainingGoal, availableEquipment, excludeContraindications, avoidMovements = [] }) => {
    if (!trainingGoal) return null;
    const matches = graph.searchExercises({
      trainingGoal,
      availableEquipment,
      excludeContraindications,
      limit: 20
    });
    const avoided = (exercise) =>
      avoidMovements.some((movement) => {
        const term = String(movement).toLowerCase();
        return `${exercise.name} ${exercise.id}`.toLowerCase().includes(term);
      });
    return matches.find((exercise) => !avoided(exercise))?.id ?? null;
  };
}

export async function generateTrainingPlanTool(args = {}) {
  if (args.startDate && !isCalendarDay(args.startDate)) {
    return invalidDate("evidra_generate_plan", "startDate", args.startDate);
  }
  const resolved = await resolveContext(args);
  if (!resolved) return evidenceRequired("evidra_generate_plan");
  if (resolved.invalid) return invalidEvidence("evidra_generate_plan", resolved.invalid);
  const { context } = resolved;
  const { displayNameFor } = await exerciseNaming();
  const findGoalAlternative = await goalAlternativeLookup();

  const plan = generateTrainingPlan(context, {
    goalId: args.goalId,
    weeks: args.weeks,
    startDate: args.startDate,
    displayNameFor,
    findGoalAlternative
  });
  return jsonContent(plan);
}

export async function getTrainingPlanTool(args = {}) {
  if (!args.plan) {
    throw new Error("get_plan is stateless: pass the caller-held plan.");
  }
  return jsonContent(args.plan);
}

export async function listTrainingPlansTool(args = {}) {
  const plans = args.plans || [];
  return jsonContent({
    userId: args.userId,
    plans: plans.filter((plan) => !args.userId || plan.userId === args.userId).map(summarizePlan)
  });
}

/**
 * What each plan tool needs from the caller. Stated per tool rather than in
 * prose, for the same reason EVIDENCE_REQUIREMENTS is: a host that reads it
 * knows what to send next.
 */
const PLAN_STATE_SHAPE = {
  evidra_preview_adjust_plan: {
    plan: "The caller-held plan, as returned by evidra_generate_plan or evidra_commit_adjust_plan. This server stores none.",
    changeRequest:
      "One of {kind:'reduce_availability', weekdayAvailableMinutes}, {kind:'add_injury', bodyRegion}, {kind:'deload_week', weekIndex}."
  },
  evidra_commit_adjust_plan: {
    plan: "The current caller-held plan — the same version the preview was built against.",
    preview: "The patch returned by evidra_preview_adjust_plan, unmodified."
  }
};

/**
 * The answer when a plan tool has nothing to compute on, or cannot read what it
 * was given.
 *
 * Same rule as the evidence path: the request was well-formed, the tool ran, and
 * it cannot produce an answer. These four paths used to throw — a missing plan,
 * a change request naming no known kind, a plan that fails validation, a preview
 * built against an older version — and every one of them reached the user as
 * "Failed to call tool", which tells the model nothing it can act on. A stale
 * preview in particular is a refusal the caller can fix in one turn by taking a
 * fresh preview, but only if it is told that is what happened.
 */
function planStateProblem(toolName, error, problem) {
  return errorContent({
    error,
    tool: toolName,
    problem,
    shape: PLAN_STATE_SHAPE[toolName],
    callerAction:
      "Send the plan you are holding — this server keeps none, so it has to travel in the call. If you hold no plan, call evidra_generate_plan first and pass what it returns."
  });
}

export async function previewPlanChangeTool(args = {}) {
  if (!args.plan) {
    return planStateProblem(
      "evidra_preview_adjust_plan",
      "plan_required",
      "No plan was supplied, so there is nothing to preview a change against."
    );
  }

  let preview;
  try {
    preview = previewPlanChange(args.plan, args.changeRequest || {});
  } catch (error) {
    return planStateProblem("evidra_preview_adjust_plan", "plan_change_refused", error.message);
  }

  return jsonContent({
    previewId: preview.previewId,
    planId: preview.planId,
    baseVersion: preview.baseVersion,
    summary: preview.summary,
    diff: preview.diff,
    // What this change stands on. It describes the change, not the plan: the
    // plan inside `patch` carries its own frame from the day it was generated,
    // and the two answer different questions.
    decisionBasis: preview.decisionBasis,
    patch: preview,
    note: "Keep this patch and apply it in the AI host or external storage."
  });
}

export async function commitPlanChangeTool(args = {}) {
  if (!args.plan || !args.preview) {
    return planStateProblem(
      "evidra_commit_adjust_plan",
      "plan_state_required",
      `Committing needs both the current plan and the preview patch; ${!args.plan ? "plan" : "preview"} was missing.`
    );
  }

  let committed;
  try {
    committed = applyPlanPreview(args.plan, args.preview);
  } catch (error) {
    return planStateProblem("evidra_commit_adjust_plan", "commit_refused", error.message);
  }

  return jsonContent({
    planId: committed.id,
    version: committed.version,
    status: committed.status,
    plan: committed,
    // Read off the preview being committed rather than recomputed: committing
    // applies a patch that was already decided, and a second computation here
    // could disagree with the one the caller approved.
    decisionBasis: args.preview.decisionBasis ?? null,
    versionHistory: buildVersionHistory(args.plan, args.preview, committed)
  });
}

export const toolHandlers = {
  evidra_assess_fitness_state: getSemanticFitnessState,
  recommend_workout: recommendTodayWorkout,
  evidra_decide_session: decideSessionTool,
  evidra_decide_exercise_substitution: decideExerciseSubstitutionTool,
  get_training_context: getTrainingContext,
  search_exercises: searchExercisesTool,
  get_exercise: getExerciseTool,
  search_workouts: searchWorkoutsTool,
  get_workout: getWorkoutTool,
  get_user_profile: getUserProfileTool,
  get_training_history: getTrainingHistoryTool,
  evidra_generate_plan: generateTrainingPlanTool,
  get_plan: getTrainingPlanTool,
  list_plans: listTrainingPlansTool,
  evidra_preview_adjust_plan: previewPlanChangeTool,
  evidra_commit_adjust_plan: commitPlanChangeTool
};

/**
 * The product's core decision primitive: take today's scheduled session, weigh
 * it against today's evidence, and return what it should become (from -> to).
 *
 * Deliberately not a recommendation — if nothing is scheduled, it says so
 * rather than inventing a suggestion.
 */
export async function decideSessionTool(args = {}) {
  if (args.date && !isCalendarDay(args.date)) {
    return invalidDate("evidra_decide_session", "date", args.date);
  }
  const resolved = await resolveContext(args);
  if (!resolved) return evidenceRequired("evidra_decide_session");
  if (resolved.invalid) return invalidEvidence("evidra_decide_session", resolved.invalid);
  const { context, provenance, defaultDate } = resolved;

  const date = args.date || defaultDate;
  const state = generateSemanticFitnessState(context, {
    date,
    timezone: context.user.timezone
  });

  // The caller supplies what was scheduled. The AI agent is the one holding the
  // user's memory — the knee injury, last week's leg day, yesterday's tabata —
  // so it passes today's session in rather than us keeping a copy of the plan.
  let scheduledSession = args.scheduledSession || null;
  const planId = args.plan?.id || null;

  const trainingLoad = computeTrainingLoad(context.workouts, { asOf: date });

  // Agents describe the session the way their user does ("bent-over row",
  // "easy walk"). Normalize to canonical ids here so the decision engine never
  // has to reason about spelling, and so what comes back can be looked up.
  const { displayNameFor, toCanonicalIds } = await exerciseNaming();
  const canonicalize = (session) =>
    session
      ? { ...session, exerciseIds: toCanonicalIds(session.exerciseIds || session.exercises || []) }
      : session;
  scheduledSession = canonicalize(scheduledSession);

  // What the athlete asked for instead. Normalized the same way as the plan so
  // the two are compared on canonical ids, not on however each was spelled.
  const proposedSession = canonicalize(args.proposedSession || null);

  const decision = decideSession({
    scheduledSession,
    proposedSession,
    displayNameFor,
    // The impulse-response ACWR supersedes the crude 7d/28d ratio when the
    // history is long enough to have converged.
    state: trainingLoad.coverage.sufficient
      ? { ...state, acuteChronicWorkloadRatio: trainingLoad.acwr, trainingLoad }
      : { ...state, trainingLoad },
    availableMinutes: args.availableMinutes,
    // Passed so the decision can declare it was carried and not consumed.
    // Only what is needed to say that — the zone seconds themselves stay in the
    // evidence the caller already holds.
    intensityDistributions: context.workouts
      .filter((workout) => workout.intensityDistribution)
      .map((workout) => ({
        startedAt: workout.startedAt,
        boundarySource: workout.intensityDistribution.boundarySource,
        derivation: workout.intensityDistribution.derivation
      })),
    // How many sessions stood on what. `provenance.rpeBasis` has carried these
    // counts all along, but a reader has to know that
    // `athlete_max_hr_age_estimate` means 220-age to get anything from them.
    // The decision turns the ones that qualify what it computed into a limit.
    rpeBasisCounts: provenance.rpeBasis
  });

  return jsonContent({
    userId: context.user.id,
    date,
    planId,
    ...decision,
    provenance: {
      ...provenance,
      scheduledSessionSource: args.scheduledSession ? "provided" : "missing",
      proposedSessionSource: args.proposedSession ? "provided" : "none"
    }
  });
}
