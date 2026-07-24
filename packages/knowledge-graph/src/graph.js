import { assertValidGraphData } from "./models.js";

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

  function getExercise(id) {
    return nodes.get(id) || null;
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
   * @param {string} exerciseId
   * @param {{ conditions?: string[], availableEquipment?: string[], avoidContraindications?: string[], limit?: number }} [options]
   */
  function findSubstitutes(exerciseId, options = {}) {
    requireExercise(exerciseId);
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
    if (avoid.length > 0) {
      results = results.filter((item) => !intersects(item.exercise.contraindications, avoid));
    }

    results.sort((a, b) => a.rank - b.rank || b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));

    return results.slice(0, limit).map((item) => ({
      id: item.exercise.id,
      name: item.exercise.name,
      reason: item.reason,
      equipment: item.exercise.equipment
    }));
  }

  /**
   * Structured multi-dimensional exercise search — the query the v2 plan calls
   * out as impossible on Peloton (e.g. "upper body only", "no equipment").
   *
   * @param {{ muscle?: string, muscleGroup?: "upper" | "lower" | "core", movementPattern?: string, availableEquipment?: string[], excludeContraindications?: string[], maxImpact?: import("./models.js").ImpactLevel, skillLevel?: string, limit?: number }} [filters]
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
    exists: (id) => nodes.has(id),
    getVariants: (id) => targets(id, "IS_VARIANT_OF"),
    getProgressions: (id) => targets(id, "PROGRESSES_TO"),
    getRegressions: (id) => targets(id, "REGRESSES_TO"),
    getAntagonists: (id) => targets(id, "ANTAGONIST_OF"),
    neighbors: (id) => outEdges(id).map((edge) => ({ type: edge.type, exercise: nodes.get(edge.to) })),
    findSubstitutes,
    searchExercises
  };
}
