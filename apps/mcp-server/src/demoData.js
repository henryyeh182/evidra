import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeStravaActivity } from "../../../packages/connectors/src/providers/strava/index.js";
import { applyNormalizedEventsToContext } from "../../../packages/connectors/src/index.js";

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
