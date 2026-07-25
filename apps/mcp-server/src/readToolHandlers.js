// Phase 2 read API: structured, zero-side-effect queries over the knowledge
// graph and the user's own record. Every payload is grounded (P3) and paginated
// before it leaves the server.
import { searchWorkouts, totalWorkingSets } from "../../../packages/knowledge-graph/src/index.js";
import { loadDemoUserContext } from "./demoData.js";
import { loadKnowledgeBase, assertGrounded, toExerciseSummary, paginate } from "./knowledgeBase.js";
import { jsonContent } from "./content.js";

function assertUserId(context, userId) {
  if (context.user.id !== userId) {
    throw new Error(`Unknown demo user: ${userId}`);
  }
}

export async function searchExercisesTool(args = {}) {
  const { graph } = await loadKnowledgeBase();

  const matches = graph.searchExercises({
    muscle: args.muscle,
    muscleGroup: args.muscleGroup,
    movementPattern: args.movementPattern,
    availableEquipment: args.availableEquipment,
    excludeContraindications: args.excludeContraindications,
    maxImpact: args.maxImpact,
    skillLevel: args.skillLevel
  });

  const payload = {
    query: {
      muscle: args.muscle ?? null,
      muscleGroup: args.muscleGroup ?? null,
      movementPattern: args.movementPattern ?? null,
      availableEquipment: args.availableEquipment ?? null,
      excludeContraindications: args.excludeContraindications ?? null,
      maxImpact: args.maxImpact ?? null,
      skillLevel: args.skillLevel ?? null
    },
    ...paginate(matches, { limit: args.limit, offset: args.offset }, toExerciseSummary)
  };

  return jsonContent(assertGrounded(payload, graph));
}

export async function getExerciseTool(args = {}) {
  const { graph } = await loadKnowledgeBase();
  const exercise = graph.getExercise(args.exerciseId);
  if (!exercise) {
    throw new Error(`Unknown exercise: ${args.exerciseId}`);
  }

  const payload = {
    exercise_id: exercise.id,
    name: exercise.name,
    movementPattern: exercise.movementPattern,
    primaryMuscle: exercise.primaryMuscle,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment,
    planeOfMotion: exercise.planeOfMotion,
    unilateral: exercise.unilateral,
    skillLevel: exercise.skillLevel,
    impactLevel: exercise.impactLevel,
    loadsJoints: exercise.loadsJoints,
    contraindications: exercise.contraindications,
    source: exercise.source,
    confidence: exercise.confidence,
    // Graph neighbours: what this progresses to, regresses to, and substitutes.
    variants: graph.getVariants(exercise.id).map(toExerciseSummary),
    progressions: graph.getProgressions(exercise.id).map(toExerciseSummary),
    regressions: graph.getRegressions(exercise.id).map(toExerciseSummary),
    substitutes: graph.findSubstitutes(exercise.id, {
      conditions: args.conditions,
      availableEquipment: args.availableEquipment,
      avoidContraindications: args.avoidContraindications,
      limit: 5
    })
  };

  return jsonContent(assertGrounded(payload, graph));
}

function summarizeWorkout(workout) {
  return {
    workout_id: workout.id,
    name: workout.name,
    durationMinutes: workout.durationMinutes,
    blockCount: workout.blocks.length,
    workingSets: totalWorkingSets(workout)
  };
}

export async function searchWorkoutsTool(args = {}) {
  const { graph, workouts } = await loadKnowledgeBase();

  const matches = searchWorkouts(workouts, graph, {
    inZone: args.inZone,
    maxDurationMinutes: args.maxDurationMinutes,
    availableEquipment: args.availableEquipment,
    muscleGroup: args.muscleGroup
  });

  const payload = {
    query: {
      inZone: args.inZone ?? null,
      maxDurationMinutes: args.maxDurationMinutes ?? null,
      availableEquipment: args.availableEquipment ?? null,
      muscleGroup: args.muscleGroup ?? null
    },
    ...paginate(matches, { limit: args.limit, offset: args.offset }, summarizeWorkout)
  };

  const knownWorkoutIds = new Set(workouts.map((workout) => workout.id));
  return jsonContent(assertGrounded(payload, graph, knownWorkoutIds));
}

export async function getWorkoutTool(args = {}) {
  const { graph, workouts } = await loadKnowledgeBase();
  const workout = workouts.find((item) => item.id === args.workoutId);
  if (!workout) {
    throw new Error(`Unknown workout: ${args.workoutId}`);
  }

  // Return the full Block/Set structure with each set's exercise resolved to a
  // real node — structure, never prose (P1).
  const payload = {
    workout_id: workout.id,
    name: workout.name,
    durationMinutes: workout.durationMinutes,
    workingSets: totalWorkingSets(workout),
    blocks: workout.blocks.map((block) => ({
      kind: block.kind,
      sets: block.sets.map((set) => {
        const exercise = graph.getExercise(set.exerciseId);
        return {
          exercise_id: set.exerciseId,
          exerciseName: exercise ? exercise.name : null,
          reps: set.reps ?? null,
          durationSeconds: set.durationSeconds ?? null,
          intensity: set.intensity ?? null,
          restSeconds: set.restSeconds ?? null,
          tempo: set.tempo ?? null
        };
      })
    }))
  };

  const knownWorkoutIds = new Set(workouts.map((item) => item.id));
  return jsonContent(assertGrounded(payload, graph, knownWorkoutIds));
}

export async function getUserProfileTool(args = {}) {
  const context = await loadDemoUserContext();
  assertUserId(context, args.userId);

  return jsonContent({
    userId: context.user.id,
    name: context.user.name,
    timezone: context.user.timezone,
    fitnessLevel: context.user.fitnessLevel,
    goals: context.goals,
    preferences: context.preferences,
    activeInjuries: context.injuries.filter((injury) => injury.status === "active"),
    availableEquipment: context.equipment.filter((item) => item.available).map((item) => item.type)
  });
}

export async function getTrainingHistoryTool(args = {}) {
  const context = await loadDemoUserContext({
    includeStravaFixture: Boolean(args.includeStravaFixture)
  });
  assertUserId(context, args.userId);

  // Sorting is server-side and always newest-first: letting the model order
  // history is exactly where Peloton went wrong.
  let workouts = [...context.workouts].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  if (args.since) {
    workouts = workouts.filter((workout) => workout.startedAt >= args.since);
  }
  if (args.type) {
    workouts = workouts.filter((workout) => workout.type === args.type);
  }

  return jsonContent({
    userId: context.user.id,
    sort: "startedAt_desc",
    ...paginate(workouts, { limit: args.limit, offset: args.offset }, (workout) => ({
      workout_log_id: workout.id,
      type: workout.type,
      name: workout.name,
      startedAt: workout.startedAt,
      durationMinutes: workout.durationMinutes,
      rpe: workout.rpe,
      trainingLoad: workout.trainingLoad,
      muscleGroups: workout.muscleGroups,
      source: workout.source
    }))
  });
}
