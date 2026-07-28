import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeStravaActivity } from "../../../packages/connectors/src/providers/strava/index.js";
import { applyNormalizedEventsToContext } from "../../../packages/connectors/src/index.js";
import { calendarDayInTimezone } from "../../../packages/domain/src/dates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "../../..");

async function readJson(relativePath) {
  const raw = await readFile(join(rootDir, relativePath), "utf8");
  return JSON.parse(raw);
}

export async function loadDemoUserContext(options = {}) {
  const context = await readJson("data/seeds/sample-user-context.json");

  if (!options.includeStravaFixture) {
    return context;
  }

  const activity = await readJson("data/fixtures/strava/activity-run.json");
  const normalizedWorkout = normalizeStravaActivity(activity);
  return applyNormalizedEventsToContext(context, [normalizedWorkout]);
}

export async function loadExerciseCatalog() {
  return readJson("data/seeds/exercises.json");
}

/**
 * The day the demo seed is written as of: its most recent piece of evidence.
 *
 * Real callers pass evidence and get today. The seed cannot — it is a fixed
 * snapshot, so answering it against the real calendar would report a healthy
 * athlete as months idle and every signal as stale, which says nothing about
 * the engine. Derived from the data rather than declared as a constant, so it
 * follows the seed instead of drifting from it.
 *
 * @returns {string|null} YYYY-MM-DD, or null if the context carries no evidence
 */
export function latestEvidenceDay(context) {
  const instants = [
    ...(context.workouts || []).map((workout) => workout.startedAt),
    ...(context.healthMetrics || []).map((metric) => metric.recordedAt)
  ].filter(Boolean);

  if (instants.length === 0) {
    return null;
  }

  const newest = instants.reduce((latest, instant) =>
    new Date(instant) > new Date(latest) ? instant : latest
  );
  return calendarDayInTimezone(newest, context.user?.timezone);
}
