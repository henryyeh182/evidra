import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(rootDir, relativePath), "utf8"));
}

/**
 * Build the set of IDs that are considered "real" for grounding checks, from
 * the seed data that ships with the repo. IDs the system mints at runtime
 * (plan_*, preview_*, session_*) are registered dynamically during an eval run
 * (see GroundingRegistry) rather than listed here.
 *
 * @returns {Promise<{ users:Set<string>, goals:Set<string>, exercises:Set<string>,
 *   workouts:Set<string>, exerciseNames:Set<string> }>}
 */
export async function loadKnownIds() {
  const context = await readJson("data/seeds/sample-user-context.json");
  const exercises = await readJson("data/seeds/exercises.json");

  return {
    users: new Set([context.user.id]),
    goals: new Set((context.goals || []).map((goal) => goal.id)),
    workouts: new Set((context.workouts || []).map((workout) => workout.id)),
    exercises: new Set(exercises.map((exercise) => exercise.id)),
    exerciseNames: new Set(exercises.map((exercise) => exercise.name.toLowerCase()))
  };
}

// Keys whose values are ID references we can ground against a known universe.
const ID_FIELDS = {
  userId: "users",
  goalId: "goals",
  planId: "plans",
  previewId: "previews",
  exercise_id: "exercises",
  exerciseId: "exercises"
};

/**
 * Tracks IDs minted by the server during a run so later tool calls that
 * reference them (get_training_plan, commit_plan_change, ...) count as grounded.
 */
export class GroundingRegistry {
  constructor(knownIds) {
    this.known = {
      users: knownIds.users,
      goals: knownIds.goals,
      exercises: knownIds.exercises,
      workouts: knownIds.workouts,
      plans: new Set(),
      previews: new Set()
    };
    this.exerciseNames = knownIds.exerciseNames;
  }

  register(bucket, id) {
    if (id && this.known[bucket]) {
      this.known[bucket].add(id);
    }
  }

  /**
   * Walk a tool result payload and check every ID-typed reference against the
   * known universe. Returns per-reference grounding results.
   *
   * @param {*} payload
   * @returns {{ id:string, field:string, bucket:string, grounded:boolean, path:string }[]}
   */
  checkPayload(payload) {
    const results = [];
    const walk = (node, path) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          const bucket = ID_FIELDS[key];
          if (bucket && typeof value === "string") {
            results.push({
              id: value,
              field: key,
              bucket,
              grounded: this.known[bucket]?.has(value) ?? false,
              path: `${path}.${key}`
            });
          }
          walk(value, `${path}.${key}`);
        }
      }
    };
    walk(payload, "$");
    return results;
  }

  /**
   * Diagnostic (non-gating): how many planned-workout exercise names resolve to
   * a real catalog exercise. This directly measures the P3/R1 gap where the
   * planner emits free-form exercise names instead of grounded exercise_ids.
   *
   * @param {*} plan
   * @returns {{ total:number, matched:number, unmatched:string[] }}
   */
  checkPlanExerciseCoverage(plan) {
    const names = [];
    for (const week of plan?.weeks || []) {
      for (const session of week.sessions || []) {
        for (const exercise of session.exercises || []) {
          names.push(exercise);
        }
      }
    }
    const unmatched = names.filter((name) => !this.exerciseNames.has(String(name).toLowerCase()));
    return {
      total: names.length,
      matched: names.length - unmatched.length,
      unmatched: [...new Set(unmatched)]
    };
  }
}
