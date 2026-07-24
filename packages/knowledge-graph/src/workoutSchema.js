const BLOCK_KINDS = ["warmup", "main", "accessory", "cooldown"];
const INTENSITY_TYPES = ["hr_zone", "rpe", "percent_1rm", "pace"];
const UNIVERSAL_EQUIPMENT = new Set(["none", "bodyweight", "outdoor"]);

/**
 * @typedef {Object} WorkoutSet
 * @property {string} exerciseId
 * @property {number=} reps
 * @property {number=} durationSeconds
 * @property {{ type: string, value: number }} intensity
 * @property {number=} restSeconds
 * @property {string=} tempo
 */

/**
 * @typedef {Object} WorkoutBlock
 * @property {"warmup" | "main" | "accessory" | "cooldown"} kind
 * @property {WorkoutSet[]} sets
 */

/**
 * @typedef {Object} StructuredWorkout
 * @property {string} id
 * @property {string} name
 * @property {number} durationMinutes
 * @property {WorkoutBlock[]} blocks
 */

function allSets(workout) {
  return workout.blocks.flatMap((block) => block.sets);
}

/**
 * Validate a structured workout. When a graph is provided, every set's
 * exerciseId must resolve to a real node — the server-side existence check the
 * v2 plan (P3) requires so LLMs cannot introduce hallucinated exercises.
 *
 * @param {StructuredWorkout} workout
 * @param {{ exists: (id: string) => boolean }} [graph]
 */
export function assertValidWorkout(workout, graph) {
  if (!workout || typeof workout !== "object") {
    throw new Error("Workout must be an object.");
  }
  for (const field of ["id", "name", "blocks"]) {
    if (workout[field] === undefined || workout[field] === null) {
      throw new Error(`Workout ${workout.id || "?"} is missing field: ${field}`);
    }
  }
  if (!Array.isArray(workout.blocks) || workout.blocks.length === 0) {
    throw new Error(`Workout ${workout.id} must contain at least one block.`);
  }

  for (const block of workout.blocks) {
    if (!BLOCK_KINDS.includes(block.kind)) {
      throw new Error(`Workout ${workout.id} has invalid block kind: ${block.kind}`);
    }
    if (!Array.isArray(block.sets) || block.sets.length === 0) {
      throw new Error(`Workout ${workout.id} block ${block.kind} must contain sets.`);
    }
    for (const set of block.sets) {
      if (!set.intensity || !INTENSITY_TYPES.includes(set.intensity.type)) {
        throw new Error(`Workout ${workout.id} has a set with invalid intensity.`);
      }
      if (set.reps === undefined && set.durationSeconds === undefined) {
        throw new Error(`Workout ${workout.id} has a set with neither reps nor durationSeconds.`);
      }
      if (graph && !graph.exists(set.exerciseId)) {
        throw new Error(`Workout ${workout.id} references unknown exercise: ${set.exerciseId}`);
      }
    }
  }

  return true;
}

/**
 * True when every set is prescribed in the given HR zone — answers the v2
 * "entirely in Zone 2" query that Peloton could not.
 */
export function isEntirelyInZone(workout, zone) {
  const sets = allSets(workout);
  return sets.length > 0 && sets.every((set) => set.intensity.type === "hr_zone" && set.intensity.value === zone);
}

export function totalWorkingSets(workout) {
  return workout.blocks
    .filter((block) => block.kind === "main" || block.kind === "accessory")
    .reduce((sum, block) => sum + block.sets.length, 0);
}

function referencedExercises(workout, graph) {
  return allSets(workout).map((set) => graph.getExercise(set.exerciseId)).filter(Boolean);
}

function workoutEquipmentSatisfied(workout, graph, availableSet) {
  return referencedExercises(workout, graph).every((exercise) =>
    exercise.equipment.every((item) => UNIVERSAL_EQUIPMENT.has(item) || availableSet.has(item))
  );
}

/**
 * Structured workout search with conditions Peloton's text search cannot honor.
 *
 * @param {StructuredWorkout[]} workouts
 * @param {{ getExercise: (id: string) => object }} graph
 * @param {{ inZone?: number, maxDurationMinutes?: number, availableEquipment?: string[], muscleGroup?: string }} [filters]
 */
export function searchWorkouts(workouts, graph, filters = {}) {
  const availableSet = filters.availableEquipment ? new Set(filters.availableEquipment) : null;

  return workouts.filter((workout) => {
    if (filters.inZone !== undefined && !isEntirelyInZone(workout, filters.inZone)) {
      return false;
    }
    if (filters.maxDurationMinutes !== undefined && workout.durationMinutes > filters.maxDurationMinutes) {
      return false;
    }
    if (availableSet && !workoutEquipmentSatisfied(workout, graph, availableSet)) {
      return false;
    }
    if (filters.muscleGroup) {
      const exercises = referencedExercises(workout, graph);
      const primaries = new Set(exercises.map((exercise) => exercise.primaryMuscle));
      const groupMuscles = {
        upper: ["chest", "back", "shoulders", "biceps", "triceps", "lats"],
        lower: ["quads", "glutes", "hamstrings", "calves", "hips"],
        core: ["core"]
      }[filters.muscleGroup];
      if (!groupMuscles || ![...primaries].every((muscle) => groupMuscles.includes(muscle))) {
        return false;
      }
    }
    return true;
  });
}
