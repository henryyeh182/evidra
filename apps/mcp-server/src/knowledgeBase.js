import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildExerciseGraph } from "../../../packages/knowledge-graph/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../../..");

let cached = null;

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(rootDir, relativePath), "utf8"));
}

/**
 * Load and cache the exercise knowledge graph and the structured workout
 * library. The graph is ~900 nodes / ~5700 edges, so it is built once per
 * process rather than per tool call.
 */
export async function loadKnowledgeBase() {
  if (!cached) {
    const [graphData, workouts] = await Promise.all([
      readJson("data/seeds/exercises-graph.json"),
      readJson("data/seeds/workouts.json")
    ]);
    cached = { graph: buildExerciseGraph(graphData), workouts };
  }
  return cached;
}

/**
 * P3 enforcement: every id-typed reference in an outgoing payload must resolve
 * to a real node before the payload leaves the server. A miss is a server bug,
 * not a user error — fail loudly rather than letting an LLM narrate a
 * hallucinated exercise.
 *
 * @param {*} payload
 * @param {{ exists: (id: string) => boolean }} graph
 * @param {Set<string>} [knownWorkoutIds]
 */
export function assertGrounded(payload, graph, knownWorkoutIds = new Set()) {
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if ((key === "exerciseId" || key === "exercise_id" || key === "id") && typeof value === "string") {
          if (value.startsWith("exercise_") && !graph.exists(value)) {
            throw new Error(`Ungrounded exercise reference at ${path}.${key}: ${value}`);
          }
          if (value.startsWith("workout_") && knownWorkoutIds.size > 0 && !knownWorkoutIds.has(value)) {
            throw new Error(`Ungrounded workout reference at ${path}.${key}: ${value}`);
          }
        }
        walk(value, `${path}.${key}`);
      }
    }
  };
  walk(payload, "$");
  return payload;
}

/** Compact projection used by list/search results to keep payloads small. */
export function toExerciseSummary(exercise) {
  return {
    exercise_id: exercise.id,
    name: exercise.name,
    primaryMuscle: exercise.primaryMuscle,
    movementPattern: exercise.movementPattern,
    equipment: exercise.equipment,
    skillLevel: exercise.skillLevel,
    impactLevel: exercise.impactLevel,
    contraindications: exercise.contraindications
  };
}

// Weakest-client budget for a single tool result. Gemini in particular handles
// long tool results unreliably, so the server enforces the cap rather than
// trusting callers to page sensibly.
const MAX_RESULT_BYTES = 4096;

/**
 * Uniform pagination envelope with a hard byte budget: the page is shrunk until
 * the serialized results fit, so no caller-supplied limit can blow past the
 * ~4KB budget. Callers learn there is more via `hasMore` and the echoed `limit`.
 */
export function paginate(items, { limit = 10, offset = 0 } = {}, project = (item) => item) {
  const requestedLimit = Math.max(1, Math.min(50, limit));
  const safeOffset = Math.max(0, offset);

  let page = items.slice(safeOffset, safeOffset + requestedLimit).map(project);
  // Measure the way the payload is actually serialized on the wire (indented,
  // see content.js) and leave headroom for the enclosing envelope.
  while (page.length > 1 && JSON.stringify(page, null, 2).length > MAX_RESULT_BYTES - 768) {
    page = page.slice(0, page.length - 1);
  }

  return {
    total: items.length,
    offset: safeOffset,
    limit: page.length,
    hasMore: safeOffset + page.length < items.length,
    results: page
  };
}
