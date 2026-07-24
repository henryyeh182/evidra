/**
 * @typedef {"squat" | "hinge" | "horizontal_push" | "vertical_push" | "horizontal_pull" | "vertical_pull" | "locomotion" | "mobility"} MovementPattern
 * @typedef {"beginner" | "intermediate" | "advanced"} SkillLevel
 * @typedef {"low" | "moderate" | "high"} ImpactLevel
 */

/**
 * @typedef {Object} ExerciseNode
 * @property {string} id
 * @property {string} name
 * @property {MovementPattern} movementPattern
 * @property {string} primaryMuscle
 * @property {string[]} secondaryMuscles
 * @property {string[]} equipment
 * @property {string} planeOfMotion
 * @property {boolean} unilateral
 * @property {SkillLevel} skillLevel
 * @property {ImpactLevel} impactLevel
 * @property {string[]} loadsJoints
 * @property {string[]} contraindications
 * @property {string} source
 * @property {number} confidence
 */

/**
 * Exercise-to-exercise relationships. Equipment and joints are modelled as node
 * properties in this dependency-free phase (they become REQUIRES_EQUIPMENT /
 * LOADS_JOINT edges once a graph database is introduced).
 *
 * @typedef {"IS_VARIANT_OF" | "PROGRESSES_TO" | "REGRESSES_TO" | "SIMILAR_TO" | "SUBSTITUTES_FOR_WHEN" | "ANTAGONIST_OF"} EdgeType
 */

/**
 * @typedef {Object} ExerciseEdge
 * @property {EdgeType} type
 * @property {string} from
 * @property {string} to
 * @property {number=} score
 * @property {string[]=} dimensions
 * @property {string[]=} conditions
 */

export const EDGE_TYPES = [
  "IS_VARIANT_OF",
  "PROGRESSES_TO",
  "REGRESSES_TO",
  "SIMILAR_TO",
  "SUBSTITUTES_FOR_WHEN",
  "ANTAGONIST_OF"
];

const REQUIRED_EXERCISE_FIELDS = [
  "id",
  "name",
  "movementPattern",
  "primaryMuscle",
  "equipment",
  "skillLevel",
  "source",
  "confidence"
];

export function assertValidExercise(exercise) {
  if (!exercise || typeof exercise !== "object") {
    throw new Error("Exercise node must be an object.");
  }
  for (const field of REQUIRED_EXERCISE_FIELDS) {
    if (exercise[field] === undefined || exercise[field] === null) {
      throw new Error(`Exercise ${exercise.id || "?"} is missing field: ${field}`);
    }
  }
  if (!Array.isArray(exercise.equipment)) {
    throw new Error(`Exercise ${exercise.id} equipment must be an array.`);
  }
  return true;
}

/**
 * Validate a raw { exercises, edges } dataset: every exercise is well-formed,
 * ids are unique, edge types are known, and every edge endpoint exists. Returns
 * the parsed dataset so callers can validate-and-load in one step.
 */
export function assertValidGraphData(data) {
  if (!data || !Array.isArray(data.exercises) || !Array.isArray(data.edges)) {
    throw new Error("Graph data must contain exercises[] and edges[].");
  }

  const ids = new Set();
  for (const exercise of data.exercises) {
    assertValidExercise(exercise);
    if (ids.has(exercise.id)) {
      throw new Error(`Duplicate exercise id: ${exercise.id}`);
    }
    ids.add(exercise.id);
  }

  for (const edge of data.edges) {
    if (!EDGE_TYPES.includes(edge.type)) {
      throw new Error(`Unknown edge type: ${edge.type}`);
    }
    if (!ids.has(edge.from)) {
      throw new Error(`Edge ${edge.type} references missing exercise: ${edge.from}`);
    }
    if (!ids.has(edge.to)) {
      throw new Error(`Edge ${edge.type} references missing exercise: ${edge.to}`);
    }
  }

  return data;
}
