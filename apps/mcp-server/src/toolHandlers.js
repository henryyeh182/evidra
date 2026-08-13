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
  getEvidenceCoverage,
  EVIDENCE_METRIC_TYPES,
  EVIDENCE_VENDOR_ASSESSMENT_TYPES
} from "../../../packages/evidence/src/index.js";
import { isCalendarDay, todayInTimezone } from "../../../packages/domain/src/dates.js";
import { loadAthleteContext, mergeAthleteEvidence } from "./stateStore.js";
import {
  searchExercisesTool,
  getExerciseTool,
  searchWorkoutsTool,
  getWorkoutTool,
  getUserProfileTool,
  getTrainingHistoryTool,
  decideExerciseSubstitutionTool
} from "./readToolHandlers.js";
import {
  explainDecision,
  recordDecision,
  attachDecisionCommit,
  submitOutcome
} from "./decisionRecords.js";
import { RELEASE_IDENTITY } from "../../../packages/release/src/index.js";
import { buildDecisionContinuity, buildTodayBrief } from "../../../packages/private-engine/src/continuity.js";

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

const SINGLE_WORKOUT_FOCUSES = Object.freeze({
  short_sprints: { focus: "Short Sprints", type: "run", intensity: "high", targetMuscleGroups: ["legs"], exercises: ["exercise_tempo_run"] },
  vo2max_intervals: { focus: "VO₂max Intervals", type: "run", intensity: "high", targetMuscleGroups: ["legs"], exercises: ["exercise_tempo_run"] },
  tempo: { focus: "Tempo Run", type: "run", intensity: "high", targetMuscleGroups: ["legs"], exercises: ["exercise_tempo_run"] },
  zone2: { focus: "Zone 2 Cardio", type: "run", intensity: "moderate", targetMuscleGroups: ["legs"], exercises: ["exercise_zone2_run"] },
  warm_up: { focus: "Warm-up", type: "mobility", intensity: "low", targetMuscleGroups: ["hips", "legs"], exercises: ["exercise_lower_body_mobility"] },
  recovery: { focus: "Recovery Walk", type: "walk", intensity: "low", targetMuscleGroups: ["legs"], exercises: ["exercise_recovery_walk"] },
  mobility: { focus: "Mobility Flow", type: "mobility", intensity: "low", targetMuscleGroups: ["hips", "legs", "core"], exercises: ["exercise_lower_body_mobility"] },
  strength: { focus: "Full-body Strength", type: "strength", intensity: "moderate", targetMuscleGroups: ["legs", "back", "core"], exercises: ["exercise_goblet_squat", "exercise_dumbbell_row"] },
  core: { focus: "Core Strength", type: "strength", intensity: "moderate", targetMuscleGroups: ["core"], exercises: ["exercise_bodyweight_squat"] }
});
const SINGLE_WORKOUT_DURATIONS = new Set([5, 10, 15, 20, 25, 30]);

/**
 * Resolve the context a call should reason over.
 *
 * The architecture has the AI layer hold the user's authorization and pass
 * evidence in as tool arguments. Identified callers may also rely on the
 * server's durable athlete record, while anonymous requests stay stateless.
 * Returns null when there is nothing to reason over; the
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
  const identity = args.__mcpHosted ? null : (args.__mcpIdentity || args.userId || null);
  if (args.evidence) {
    let context;
    let defaultDate;
    try {
      context = evidenceToUserContext(args.evidence, { userId: identity || args.userId });
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
    const stateOptions = args.__mcpStateDirectory ? { directory: args.__mcpStateDirectory } : {};
    const persisted = identity ? await mergeAthleteEvidence(identity, context, stateOptions) : null;
    return {
      context: persisted || context,
      defaultDate,
      provenance: {
        evidenceSource: "provided",
        ...(persisted ? { continuity: { identity, storage: "server_durable_record" } } : {}),
        ...describeEvidence(args.evidence)
      }
    };
  }

  if (identity) {
    const stateOptions = args.__mcpStateDirectory ? { directory: args.__mcpStateDirectory } : {};
    const context = await loadAthleteContext(identity, stateOptions);
    if (context) {
      return {
        context,
        defaultDate: todayInTimezone(context.user.timezone),
        provenance: {
          evidenceSource: "server_durable_record",
          continuity: { identity, storage: "server_durable_record" },
          note: "Evidence was loaded from the athlete record shared across MCP hosts and conversations."
        }
      };
    }
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

export async function getEvidenceCoverageTool(args = {}) {
  if (!args.evidence) return evidenceRequired("get_evidence_coverage");
  try {
    evidenceToUserContext(args.evidence, { userId: args.userId });
  } catch (error) {
    return invalidEvidence("get_evidence_coverage", error.message);
  }
  return jsonContent({
    userId: args.userId || null,
    ...getEvidenceCoverage(args.evidence),
    provenance: {
      evidenceSource: "provided",
      ...describeEvidence(args.evidence),
      runtimeIdentity: RELEASE_IDENTITY
    }
  });
}

export async function explainDecisionTool(args = {}) {
  if (typeof args.decisionId !== "string" || args.decisionId.length === 0) {
    return errorContent({
      error: "decision_id_required",
      tool: "explain_decision",
      problem: "Pass the decisionId returned by a decision tool."
    });
  }
  const record = explainDecision(args.decisionId, { decisionRepository: args.__decisionRepository, userId: args.userId ?? null });
  if (!record) {
    return errorContent({
      error: "decision_not_found",
      tool: "explain_decision",
      decisionId: args.decisionId,
      problem: "The process-local trace has expired or was created by another server instance.",
      callerAction: "Use the decision record held by the caller, or request a new decision."
    });
  }
  return jsonContent(record);
}

export async function submitOutcomeTool(args = {}) {
  if (typeof args.caseId !== "string" || args.caseId.length === 0) {
    return errorContent({ error: "case_id_required", tool: "submit_outcome", problem: "caseId is required." });
  }
  if (!args.outcome || typeof args.outcome !== "object" || Array.isArray(args.outcome)) {
    return errorContent({ error: "outcome_required", tool: "submit_outcome", problem: "outcome must be an object." });
  }
  const persistence = await submitOutcome(args.caseId, args.outcome, {
    repository: args.__outcomeRepository,
    userId: args.userId ?? null,
    decisionId: args.decisionId ?? null
  });
  return jsonContent({
    caseId: args.caseId,
    ...persistence,
    runtimeIdentity: RELEASE_IDENTITY,
    note: persistence.persistence === "process_local"
      ? "Process-local MVP only. Use the user-controlled private engine to persist Outcome events."
      : "Persisted in the user-controlled private engine repository. Hosted/stateless requests never use this path."
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
      availableEquipment
    });
    const excludedByContraindication = matches
      .filter((exercise) =>
        (exercise.contraindications || []).some((tag) => (excludeContraindications || []).includes(tag))
      )
      .map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        matchedTags: (exercise.contraindications || []).filter((tag) => (excludeContraindications || []).includes(tag))
      }));
    const safeMatches = matches
      .filter((exercise) => !excludedByContraindication.some((item) => item.id === exercise.id))
      .slice(0, 20);
    const avoided = (exercise) =>
      avoidMovements.some((movement) => {
        const term = String(movement).toLowerCase();
        return `${exercise.name} ${exercise.id}`.toLowerCase().includes(term);
      });
    return {
      exerciseId: safeMatches.find((exercise) => !avoided(exercise))?.id ?? null,
      excludedByContraindication
    };
  };
}

export async function generateTrainingPlanTool(args = {}) {
  if (args.startDate && !isCalendarDay(args.startDate)) {
    return invalidDate("evidra_generate_plan", "startDate", args.startDate);
  }
  const resolved = await resolveContext(args);
  if (!resolved) return evidenceRequired("evidra_generate_plan");
  if (resolved.invalid) return invalidEvidence("evidra_generate_plan", resolved.invalid);
  const { context, provenance } = resolved;
  const { displayNameFor } = await exerciseNaming();
  const findGoalAlternative = await goalAlternativeLookup();

  const plan = generateTrainingPlan(context, {
    goalId: args.goalId,
    weeks: args.weeks,
    startDate: args.startDate,
    displayNameFor,
    findGoalAlternative
  });
  const planDecision = recordDecision({
    tool: "generate_plan",
    userId: context.user.id,
    decision: { type: "plan_generated", intent: "build_training_plan" },
    action: { type: "create_plan", planId: plan.id, version: plan.version },
    reason: plan.reasoning,
    evidence: [
      { signal: "goal", value: context.goals, source: "provided" },
      { signal: "constraints", value: plan.constraints, source: "provided" },
      { signal: "training_history", value: context.workouts, source: "provided" }
    ],
    decisionBasis: plan.decisionBasis ?? null,
    provenance,
    versions: { plan: plan.version },
    planSnapshot: structuredClone(plan),
    ...plan
  }, { userId: context.user.id, evidenceSource: provenance.evidenceSource, decisionRepository: args.__decisionRepository });
  return jsonContent({ decisionId: planDecision.decisionId, ...plan });
}

export async function generateWorkoutTool(args = {}) {
  if (!SINGLE_WORKOUT_DURATIONS.has(args.durationMinutes)) {
    return errorContent({ error: "invalid_workout_duration", tool: "evidra_generate_workout", problem: "durationMinutes must be one of 5, 10, 15, 20, 25 or 30.", allowed: [...SINGLE_WORKOUT_DURATIONS] });
  }
  if (typeof args.focus !== "string" || !SINGLE_WORKOUT_FOCUSES[args.focus]) {
    return errorContent({ error: "invalid_workout_focus", tool: "evidra_generate_workout", problem: "focus must be one of the supported single-workout focus values.", allowed: Object.keys(SINGLE_WORKOUT_FOCUSES) });
  }
  const scheduledSession = { ...SINGLE_WORKOUT_FOCUSES[args.focus], durationMinutes: args.durationMinutes };
  const decisionResult = await decideSessionTool({
    ...args,
    __decisionRepository: args.__decisionRepository,
    scheduledSession,
    availableMinutes: args.availableMinutes ?? args.evidence?.constraints?.availableMinutes
  });
  const payload = JSON.parse(decisionResult.content[0].text);
  if (decisionResult.isError) return errorContent({ ...payload, tool: "evidra_generate_workout" });
  return jsonContent({
    tool: "generate_workout", decisionId: payload.decisionId, userId: payload.userId, date: payload.date,
    request: { durationMinutes: args.durationMinutes, focus: args.focus },
    decision: { type: "workout_generated", intent: "build_single_workout", adjustment: payload.decision },
    action: payload.action, workout: payload.action.to, reason: payload.reason,
    decisionBasis: payload.decisionBasis, confidence: payload.confidence, signalCoverage: payload.signalCoverage,
    provenance: { ...payload.provenance, requestedFocus: args.focus, requestedDurationMinutes: args.durationMinutes, scheduledSessionSource: "picker" }
  });
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

  const previewDecision = recordDecision({
    tool: "preview_adjust_plan",
    userId: args.plan.userId ?? null,
    decision: { type: "plan_change_preview", intent: preview.changeRequest.kind },
    action: { type: "preview_plan_change", planId: preview.planId, baseVersion: preview.baseVersion },
    reason: [preview.summary],
    evidence: [
      { signal: "change_request", value: preview.changeRequest, source: "caller" },
      { signal: "base_plan", value: { planId: preview.planId, version: preview.baseVersion }, source: "caller" }
    ],
    decisionBasis: preview.decisionBasis,
    provenance: { evidenceSource: "caller", previewId: preview.previewId },
    versions: { basePlan: preview.baseVersion },
    planSnapshot: structuredClone(preview.resultingPlan),
    previewSnapshot: structuredClone(preview)
  }, { userId: args.plan.userId ?? null, evidenceSource: "caller", decisionRepository: args.__decisionRepository });

  return jsonContent({
    decisionId: previewDecision.decisionId,
    previewId: preview.previewId,
    planId: preview.planId,
    baseVersion: preview.baseVersion,
    summary: preview.summary,
    diff: preview.diff,
    // What this change stands on. It describes the change, not the plan: the
    // plan inside `patch` carries its own frame from the day it was generated,
    // and the two answer different questions.
    decisionBasis: preview.decisionBasis,
    patch: { ...preview, decisionId: previewDecision.decisionId },
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

  const versionHistory = buildVersionHistory(args.plan, args.preview, committed);
  const plan = { ...committed, versionHistory };
  const previewDecisionId = args.preview.decisionId;
  let decisionId = previewDecisionId;
  if (decisionId) {
    const attached = attachDecisionCommit(decisionId, {
      previewId: args.preview.previewId,
      committedPlanId: plan.id,
      committedPlanVersion: plan.version,
      baseVersion: args.preview.baseVersion,
      committedPlanSnapshot: structuredClone(plan)
    }, args.__decisionRepository);
    if (!attached) {
      return errorContent({
        error: "decision_trace_not_found",
        tool: "evidra_commit_adjust_plan",
        decisionId,
        problem: "The preview trace expired or belongs to another server instance, so the commit cannot preserve its lineage.",
        callerAction: "Request a fresh preview and commit that patch without modifying it."
      });
    }
  } else {
    // Backward-compatible handling for previews produced before trace
    // registration existed. New callers always take the branch above.
    decisionId = recordDecision({
      tool: "commit_adjust_plan",
      userId: plan.userId ?? null,
      decision: { type: "plan_change_commit", intent: "commit_preview" },
      action: { type: "commit_plan_change", planId: plan.id, version: plan.version },
      evidence: [{ signal: "preview", value: args.preview, source: "caller" }],
      decisionBasis: args.preview.decisionBasis ?? null,
      provenance: { evidenceSource: "caller", previewId: args.preview.previewId },
      versions: { basePlan: args.preview.baseVersion, committedPlan: plan.version },
      planSnapshot: structuredClone(plan)
    }, { userId: plan.userId ?? null, evidenceSource: "caller", decisionRepository: args.__decisionRepository }).decisionId;
  }
  return jsonContent({
    decisionId,
    previewDecisionId: previewDecisionId ?? null,
    planId: plan.id,
    version: plan.version,
    status: plan.status,
    plan,
    // Read off the preview being committed rather than recomputed: committing
    // applies a patch that was already decided, and a second computation here
    // could disagree with the one the caller approved.
    decisionBasis: args.preview.decisionBasis ?? null,
    versionHistory
  });
}

export const toolHandlers = {
  evidra_assess_fitness_state: getSemanticFitnessState,
  get_evidence_coverage: getEvidenceCoverageTool,
  explain_decision: explainDecisionTool,
  submit_outcome: submitOutcomeTool,
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
  evidra_generate_workout: generateWorkoutTool,
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

  const continuity = buildDecisionContinuity({ userId: context.user.id, date, timezone: context.user.timezone, state, context });
  const decisionProvenance = {
    ...provenance,
    ...continuity,
    earliest: continuity.evidenceWindow.earliest,
    latest: continuity.evidenceWindow.latest,
    scheduledSessionSource: args.scheduledSession ? "provided" : "missing",
    proposedSessionSource: args.proposedSession ? "provided" : "none"
  };

  return jsonContent(recordDecision({
    userId: context.user.id,
    date,
    planId,
    ...decision,
    provenance: decisionProvenance,
    todayBrief: buildTodayBrief({
      userId: context.user.id,
      date,
      decision,
      state,
      context,
      provenance: continuity
    })
  }, { userId: context.user.id, evidenceSource: provenance.evidenceSource, decisionRepository: args.__decisionRepository }));
}
