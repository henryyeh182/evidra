// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidGraphData } from "./models.js";
import { THRESHOLDS, ENGINE_THRESHOLD_KEYS } from "../../rules/src/index.js";

// This catalog's own thresholds, narrowed to the keys it declared.
const RULES = Object.freeze(
  Object.fromEntries(ENGINE_THRESHOLD_KEYS.catalog.map((key) => [key, THRESHOLDS[key]]))
);

const UNIVERSAL_EQUIPMENT = new Set(["none", "bodyweight", "outdoor"]);

const MUSCLE_GROUPS = {
  upper: new Set(["chest", "back", "shoulders", "biceps", "triceps", "lats"]),
  lower: new Set(["quads", "glutes", "hamstrings", "calves", "hips"]),
  core: new Set(["core"])
};

function equipmentSatisfied(required, availableSet) {
  return required.every((item) => UNIVERSAL_EQUIPMENT.has(item) || availableSet.has(item));
}

function intersects(a, b) {
  return a.some((item) => b.includes(item));
}

/** Which tags two lists share. EVD-R-012 reports these, so they are kept rather than counted away. */
function sharedTags(a, b) {
  return a.filter((item) => b.includes(item));
}

/**
 * Build an in-memory exercise knowledge graph with traversal queries. This is
 * the "DB layer" the v2 plan describes: substitutions, progressions, and
 * structured search are single traversals rather than LLM guesses. It is
 * intentionally dependency-free so it can be re-backed by recursive CTEs or a
 * graph database later without changing the query surface.
 *
 * @param {{ exercises: import("./models.js").ExerciseNode[], edges: import("./models.js").ExerciseEdge[] }} data
 */
export function buildExerciseGraph(data) {
  assertValidGraphData(data);

  const nodes = new Map(data.exercises.map((exercise) => [exercise.id, exercise]));
  const outgoing = new Map();
  const incoming = new Map();

  for (const id of nodes.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of data.edges) {
    outgoing.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }

  // Colloquial term -> canonical id. Built once so resolution is a lookup, not
  // a scan, and so an ambiguous term is impossible by construction (the data
  // validator rejects a term claimed by two exercises).
  const byTerm = new Map();
  for (const exercise of data.exercises) {
    const claim = (term) => {
      if (term === undefined || term === null) return;
      const key = String(term).trim().toLowerCase();
      if (key) byTerm.set(key, exercise.id);
    };
    claim(exercise.name);
    claim(exercise.displayName);
    for (const alias of exercise.aliases || []) claim(alias);
  }

  function getExercise(id) {
    return nodes.get(id) || null;
  }

  /**
   * Resolve however the caller said it — canonical id, canonical name, display
   * name, or a colloquial alias — to the one exercise it means. This is the
   * only sanctioned way free text becomes an id; everything downstream of it
   * works in ids alone.
   *
   * @param {string} term
   * @returns {import("./models.js").ExerciseNode | null}
   */
  function resolveExercise(term) {
    if (term === undefined || term === null) return null;
    const raw = String(term).trim();
    if (nodes.has(raw)) return nodes.get(raw);
    const id = byTerm.get(raw.toLowerCase());
    return id ? nodes.get(id) : null;
  }

  /**
   * What to show a human for an id. Falls back to the canonical name, then to
   * the id itself, so an unresolvable reference is visible rather than blank.
   */
  function displayNameFor(id) {
    const exercise = nodes.get(id);
    if (!exercise) return String(id);
    return exercise.displayName || exercise.name;
  }

  function requireExercise(id) {
    const exercise = nodes.get(id);
    if (!exercise) {
      throw new Error(`Unknown exercise: ${id}`);
    }
    return exercise;
  }

  function outEdges(id, type) {
    const edges = outgoing.get(id) || [];
    return type ? edges.filter((edge) => edge.type === type) : edges;
  }

  function inEdges(id, type) {
    const edges = incoming.get(id) || [];
    return type ? edges.filter((edge) => edge.type === type) : edges;
  }

  function targets(id, type) {
    return outEdges(id, type).map((edge) => nodes.get(edge.to));
  }

  /**
   * Find safe substitutes for an exercise given the situation. Combines
   * conditional SUBSTITUTES_FOR_WHEN edges, easier regressions, and similar
   * movements, then filters by available equipment and injury contraindications.
   *
   * `preserveTrainingGoal` narrows candidates to those that still serve one of
   * the original's training goals. It is off by default: when someone cannot
   * train today, a movement that changes the stimulus is often exactly the
   * right answer (a run becomes a recovery walk), and the caller is the one who
   * knows which of the two situations it is in.
   *
   * @param {string} exerciseId
   * @param {{ conditions?: string[], availableEquipment?: string[], avoidContraindications?: string[], preserveTrainingGoal?: boolean, limit?: number }} [options]
   */
  function collectSubstituteCandidates(exerciseId, options = {}) {
    const original = requireExercise(exerciseId);
    const conditions = options.conditions || [];
    const availableSet = options.availableEquipment ? new Set(options.availableEquipment) : null;
    const avoid = options.avoidContraindications || [];
    const limit = options.limit || 5;

    /** @type {Map<string, { exercise: import("./models.js").ExerciseNode, rank: number, score: number, reason: string }>} */
    const candidates = new Map();

    function consider(id, rank, score, reason) {
      if (id === exerciseId || !nodes.has(id)) {
        return;
      }
      const existing = candidates.get(id);
      if (!existing || rank < existing.rank || (rank === existing.rank && score > existing.score)) {
        candidates.set(id, { exercise: nodes.get(id), rank, score, reason });
      }
    }

    // 1. Conditional substitutes: inbound SUBSTITUTES_FOR_WHEN edges.
    for (const edge of inEdges(exerciseId, "SUBSTITUTES_FOR_WHEN")) {
      const edgeConditions = edge.conditions || [];
      const matched = conditions.length === 0 || intersects(conditions, edgeConditions);
      if (matched) {
        const detail = edgeConditions.length ? ` for ${edgeConditions.join("/")}` : "";
        consider(edge.from, 0, 1, `Direct substitute${detail}.`);
      }
    }

    // 2. Easier regressions of the target.
    for (const edge of outEdges(exerciseId, "REGRESSES_TO")) {
      consider(edge.to, 1, 0.6, "Lower-skill regression.");
    }

    // 3. Similar movements (either direction).
    for (const edge of [...outEdges(exerciseId, "SIMILAR_TO"), ...inEdges(exerciseId, "SIMILAR_TO")]) {
      const otherId = edge.from === exerciseId ? edge.to : edge.from;
      consider(otherId, 2, edge.score ?? 0.5, `Similar movement (score ${edge.score ?? "n/a"}).`);
    }

    let results = [...candidates.values()];

    if (availableSet) {
      results = results.filter((item) => equipmentSatisfied(item.exercise.equipment, availableSet));
    }

    // The contraindication filter, kept apart from the others because it is the
    // one a rule is attributed to. What it excluded is returned rather than
    // discarded: a substitution that quietly dropped three candidates for a
    // named joint and one for missing equipment looks identical from outside,
    // and only the first is a safety decision anyone has to be able to audit.
    const excludedByContraindication = [];
    if (avoid.length > 0) {
      results = results.filter((item) => {
        const matched = sharedTags(item.exercise.contraindications, avoid);
        if (matched.length >= RULES.contraindicationTagsMatched) {
          excludedByContraindication.push({
            id: item.exercise.id,
            name: item.exercise.name,
            matchedTags: matched
          });
          return false;
        }
        return true;
      });
    }

    if (options.preserveTrainingGoal) {
      results = results.filter((item) => intersects(item.exercise.trainingGoals, original.trainingGoals));
    }

    results.sort((a, b) => a.rank - b.rank || b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));

    return {
      substitutes: results.slice(0, limit).map((item) => ({
        id: item.exercise.id,
        name: item.exercise.name,
        reason: item.reason,
        equipment: item.exercise.equipment,
        trainingGoals: item.exercise.trainingGoals,
        // Whether this swap keeps the session doing what it was for. A caller can
        // still choose a candidate that does not, but never without being told.
        preservesTrainingGoal: intersects(item.exercise.trainingGoals, original.trainingGoals)
      })),
      excludedByContraindication
    };
  }

  /**
   * The substitutes alone, for the callers that only want the list.
   *
   * Kept as the plain shape it has always had, so that adding a trace to one
   * caller did not change the return type under every other one.
   */
  function findSubstitutes(exerciseId, options = {}) {
    return collectSubstituteCandidates(exerciseId, options).substitutes;
  }

  /**
   * Structured multi-dimensional exercise search — the query the v2 plan calls
   * out as impossible on Peloton (e.g. "upper body only", "no equipment").
   *
   * @param {{ muscle?: string, muscleGroup?: "upper" | "lower" | "core", movementPattern?: string, trainingGoal?: import("./models.js").TrainingGoal, availableEquipment?: string[], excludeContraindications?: string[], maxImpact?: import("./models.js").ImpactLevel, skillLevel?: string, limit?: number }} [filters]
   */
  function searchExercises(filters = {}) {
    const availableSet = filters.availableEquipment ? new Set(filters.availableEquipment) : null;
    const impactRank = { low: 0, moderate: 1, high: 2 };
    const groupMuscles = filters.muscleGroup ? MUSCLE_GROUPS[filters.muscleGroup] : null;

    let results = [...nodes.values()].filter((exercise) => {
      if (filters.muscle) {
        const muscles = [exercise.primaryMuscle, ...exercise.secondaryMuscles];
        if (!muscles.includes(filters.muscle)) {
          return false;
        }
      }
      if (groupMuscles && !groupMuscles.has(exercise.primaryMuscle)) {
        return false;
      }
      if (filters.movementPattern && exercise.movementPattern !== filters.movementPattern) {
        return false;
      }
      if (filters.trainingGoal && !exercise.trainingGoals.includes(filters.trainingGoal)) {
        return false;
      }
      if (filters.skillLevel && exercise.skillLevel !== filters.skillLevel) {
        return false;
      }
      if (availableSet && !equipmentSatisfied(exercise.equipment, availableSet)) {
        return false;
      }
      if (filters.excludeContraindications && intersects(exercise.contraindications, filters.excludeContraindications)) {
        return false;
      }
      if (filters.maxImpact && impactRank[exercise.impactLevel] > impactRank[filters.maxImpact]) {
        return false;
      }
      return true;
    });

    results.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
    return filters.limit ? results.slice(0, filters.limit) : results;
  }

  return {
    size: nodes.size,
    edgeCount: data.edges.length,
    getExercise,
    resolveExercise,
    displayNameFor,
    exists: (id) => nodes.has(id),
    getVariants: (id) => targets(id, "IS_VARIANT_OF"),
    getProgressions: (id) => targets(id, "PROGRESSES_TO"),
    getRegressions: (id) => targets(id, "REGRESSES_TO"),
    getAntagonists: (id) => targets(id, "ANTAGONIST_OF"),
    neighbors: (id) => outEdges(id).map((edge) => ({ type: edge.type, exercise: nodes.get(edge.to) })),
    findSubstitutes,
    collectSubstituteCandidates,
    searchExercises
  };
}
