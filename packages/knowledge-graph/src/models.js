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

const SKILL_RANK = { beginner: 0, intermediate: 1, advanced: 2 };

/**
 * Progression edges carry a direction, which similarity edges do not. These
 * invariants are what keeps that direction meaningful — without them a
 * generator can emit `PROGRESSES_TO` for any two related movements and the
 * graph will happily serve it as a coaching relation.
 *
 * 1. Reciprocity — `A PROGRESSES_TO B` iff `B REGRESSES_TO A`. A ladder you can
 *    only climb is a ladder `findSubstitutes` cannot use, since it looks for
 *    regressions.
 * 2. Skill is non-decreasing along `PROGRESSES_TO`, so a progression can never
 *    hand back something the athlete is more qualified for than the original.
 * 3. No contradictions — B cannot be both a progression and a regression of A.
 * 4. Acyclic — a cycle means "harder than itself", and would let a caller loop
 *    forever looking for the next rung.
 *
 * @param {{ exercises: ExerciseNode[], edges: ExerciseEdge[] }} data
 */
export function assertValidProgressions(data) {
  const skillById = new Map(data.exercises.map((e) => [e.id, SKILL_RANK[e.skillLevel] ?? 1]));
  const progresses = new Set();
  const regresses = new Set();

  for (const edge of data.edges) {
    if (edge.type === "PROGRESSES_TO") progresses.add(`${edge.from}->${edge.to}`);
    if (edge.type === "REGRESSES_TO") regresses.add(`${edge.from}->${edge.to}`);
  }

  for (const key of progresses) {
    const [from, to] = key.split("->");
    if (!regresses.has(`${to}->${from}`)) {
      throw new Error(`PROGRESSES_TO ${from} -> ${to} has no matching REGRESSES_TO ${to} -> ${from}`);
    }
    if (skillById.get(to) < skillById.get(from)) {
      throw new Error(`PROGRESSES_TO ${from} -> ${to} moves to a lower skill level`);
    }
    if (progresses.has(`${to}->${from}`)) {
      throw new Error(`${from} and ${to} are progressions of each other`);
    }
  }

  for (const key of regresses) {
    const [from, to] = key.split("->");
    if (!progresses.has(`${to}->${from}`)) {
      throw new Error(`REGRESSES_TO ${from} -> ${to} has no matching PROGRESSES_TO ${to} -> ${from}`);
    }
  }

  // Cycle check over PROGRESSES_TO. Skill monotonicity alone does not rule one
  // out: a ring of same-level movements would satisfy it.
  const next = new Map();
  for (const key of progresses) {
    const [from, to] = key.split("->");
    if (!next.has(from)) next.set(from, []);
    next.get(from).push(to);
  }
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();
  const walk = (id, trail) => {
    if (state.get(id) === DONE) return;
    if (state.get(id) === VISITING) {
      throw new Error(`PROGRESSES_TO cycle: ${[...trail, id].join(" -> ")}`);
    }
    state.set(id, VISITING);
    for (const child of next.get(id) || []) walk(child, [...trail, id]);
    state.set(id, DONE);
  };
  for (const id of next.keys()) walk(id, []);

  return data;
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
    if (edge.from === edge.to) {
      throw new Error(`Edge ${edge.type} is a self-loop on ${edge.from}`);
    }
  }

  assertValidProgressions(data);

  return data;
}
