// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

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
  const graph = await readJson("data/seeds/exercises-graph.json");
  const workoutLibrary = await readJson("data/seeds/workouts.json");

  // The knowledge graph is the authority on which exercises exist; the small
  // demo catalog is a subset kept for the legacy context tool.
  const exerciseIds = new Set([
    ...exercises.map((exercise) => exercise.id),
    ...graph.exercises.map((exercise) => exercise.id)
  ]);

  return {
    users: new Set([context.user.id]),
    // The planner deliberately uses this stable fallback when a caller does
    // not provide an explicit goal. It is a canonical system value, not a
    // runtime-minted ID, so it belongs in the grounding universe.
    goals: new Set([
      ...(context.goals || []).map((goal) => goal.id),
      "goal_general_fitness"
    ]),
    workouts: new Set([
      ...(context.workouts || []).map((workout) => workout.id),
      ...workoutLibrary.map((workout) => workout.id)
    ]),
    exercises: exerciseIds,
    // Every sanctioned spelling of a movement: canonical name, the spoken form,
    // and the colloquial aliases callers are allowed to send in. A name that
    // resolves through any of these is grounded — the id behind them is one.
    exerciseNames: new Set([
      ...exercises.map((exercise) => exercise.name.toLowerCase()),
      ...graph.exercises.flatMap((exercise) =>
        [exercise.name, exercise.displayName, ...(exercise.aliases || [])]
          .filter(Boolean)
          .map((term) => String(term).toLowerCase())
      )
    ])
  };
}

// Keys whose values are ID references we can ground against a known universe.
const ID_FIELDS = {
  userId: "users",
  goalId: "goals",
  planId: "plans",
  previewId: "previews",
  exercise_id: "exercises",
  exerciseId: "exercises",
  workout_id: "workouts",
  workout_log_id: "workouts"
};

/**
 * Tracks IDs minted by the server during a run so later tool calls that
 * reference them (get_plan, evidra_commit_adjust_plan, ...) count as grounded.
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
   * How much of a plan's prescribed work points at something that exists.
   *
   * Sessions carry `exerciseIds` (canonical) alongside `exercises` (spoken).
   * Ids are checked against the catalog's ids, which is a real reference check
   * rather than a spelling comparison; a session that still only carries names
   * falls back to matching any sanctioned spelling. This used to sit at 62.5%
   * because the planner authored its own free-text names.
   *
   * @param {*} plan
   * @returns {{ total:number, matched:number, unmatched:string[] }}
   */
  checkPlanExerciseCoverage(plan) {
    const refs = [];
    for (const week of plan?.weeks || []) {
      for (const session of week.sessions || []) {
        if (session.exerciseIds?.length) {
          for (const id of session.exerciseIds) refs.push({ value: id, byId: true });
        } else {
          for (const name of session.exercises || []) refs.push({ value: name, byId: false });
        }
      }
    }
    const unmatched = refs
      .filter((ref) =>
        ref.byId
          ? !this.known.exercises.has(ref.value)
          : !this.exerciseNames.has(String(ref.value).toLowerCase())
      )
      .map((ref) => ref.value);
    return {
      total: refs.length,
      matched: refs.length - unmatched.length,
      unmatched: [...new Set(unmatched)]
    };
  }
}
