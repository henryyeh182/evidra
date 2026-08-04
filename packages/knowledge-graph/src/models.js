// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * @typedef {"squat" | "hinge" | "horizontal_push" | "vertical_push" | "horizontal_pull" | "vertical_pull" | "locomotion" | "mobility"} MovementPattern
 * @typedef {"beginner" | "intermediate" | "advanced"} SkillLevel
 * @typedef {"low" | "moderate" | "high"} ImpactLevel
 * @typedef {"strength" | "hypertrophy" | "power" | "endurance" | "mobility"} TrainingGoal
 */

/**
 * What training quality a movement serves. This is a property of the movement
 * itself — like `equipment` or `contraindications` — not a relationship, which
 * is why it is a node attribute and not a sixth edge type: "A can replace B"
 * questions are already expressible through `SUBSTITUTES_FOR_WHEN` conditions.
 *
 * It exists so that swapping a movement can preserve the training stimulus.
 * Without it, an upper-body strength slot whose equipment is unavailable falls
 * back to whatever else is safe and available, and the session quietly stops
 * being the session that was prescribed.
 */
export const TRAINING_GOALS = ["strength", "hypertrophy", "power", "endurance", "mobility"];

/**
 * A movement that claims every goal discriminates between none of them, which
 * is the failure mode this attribute has to survive: it is easy to make ladder
 * or goal coverage look complete by labelling everything with everything.
 */
const MAX_GOALS_PER_EXERCISE = 3;

/**
 * Patterns whose defining quality is not negotiable. A mobility flow that does
 * not claim mobility, or a run that does not claim endurance, means the label
 * was applied without looking at the movement.
 */
const REQUIRED_GOAL_BY_PATTERN = {
  mobility: "mobility",
  locomotion: "endurance",
  plyometric: "power"
};

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
 * @property {TrainingGoal[]} trainingGoals
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
  "trainingGoals",
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
 * Naming has three layers, and they must not be confused:
 *
 *   `id`          canonical. The only thing decisions, plans and stored data
 *                 ever reference. Fixed forever.
 *   `name`        canonical spelling — precise and equipment-qualified so two
 *                 variants are never the same string ("Bent-over Barbell Row").
 *   `displayName` what a coach says out loud ("Bent-over Row"). Output only.
 *   `aliases`     colloquial spellings accepted as input, lower-cased.
 *
 * An alias claimed by two exercises makes the mapping ambiguous, which would
 * mean the same words resolve differently depending on iteration order. That is
 * exactly the drift this layer exists to prevent, so it is an error.
 *
 * @param {{ exercises: ExerciseNode[] }} data
 */
export function assertUniqueExerciseNaming(data) {
  const claimed = new Map();
  const claim = (term, id, kind) => {
    if (term === undefined || term === null) return;
    const key = String(term).trim().toLowerCase();
    if (!key) return;
    const existing = claimed.get(key);
    if (existing && existing !== id) {
      throw new Error(`Ambiguous exercise ${kind} "${term}": claimed by both ${existing} and ${id}`);
    }
    claimed.set(key, id);
  };

  for (const exercise of data.exercises) {
    claim(exercise.name, exercise.id, "name");
    claim(exercise.displayName, exercise.id, "displayName");
    for (const alias of exercise.aliases || []) claim(alias, exercise.id, "alias");
  }

  return data;
}

/**
 * Training goals carry meaning only while they discriminate. These invariants
 * are what stops the attribute decaying into a label everything wears:
 *
 * 1. Known values only — a typo'd goal silently matches nothing, so a slot that
 *    asks for it falls back instead of failing loudly.
 * 2. At least one — an unlabelled movement can never be chosen to serve a goal,
 *    which makes it invisible to the very queries this attribute exists for.
 * 3. At most three — a movement claiming everything preserves nothing when it
 *    is substituted in.
 * 4. The pattern's defining quality is present (a run is endurance, a mobility
 *    flow is mobility, a plyometric is power).
 *
 * @param {{ exercises: ExerciseNode[] }} data
 */
export function assertValidTrainingGoals(data) {
  const allowed = new Set(TRAINING_GOALS);

  for (const exercise of data.exercises) {
    const goals = exercise.trainingGoals;
    if (!Array.isArray(goals)) {
      throw new Error(`Exercise ${exercise.id} trainingGoals must be an array.`);
    }
    if (goals.length === 0) {
      throw new Error(`Exercise ${exercise.id} declares no training goal.`);
    }
    if (goals.length > MAX_GOALS_PER_EXERCISE) {
      throw new Error(
        `Exercise ${exercise.id} claims ${goals.length} training goals (max ${MAX_GOALS_PER_EXERCISE}): ${goals.join(", ")}`
      );
    }
    if (new Set(goals).size !== goals.length) {
      throw new Error(`Exercise ${exercise.id} repeats a training goal: ${goals.join(", ")}`);
    }
    for (const goal of goals) {
      if (!allowed.has(goal)) {
        throw new Error(`Exercise ${exercise.id} has unknown training goal: ${goal}`);
      }
    }
    const required = REQUIRED_GOAL_BY_PATTERN[exercise.movementPattern];
    if (required && !goals.includes(required)) {
      throw new Error(
        `Exercise ${exercise.id} is a ${exercise.movementPattern} movement but does not serve ${required}: ${goals.join(", ")}`
      );
    }
  }

  return data;
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
  assertUniqueExerciseNaming(data);
  assertValidTrainingGoals(data);

  return data;
}
