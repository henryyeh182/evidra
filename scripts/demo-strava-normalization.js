import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeStravaActivity } from "../packages/connectors/src/providers/strava/index.js";
import { applyNormalizedEventsToContext } from "../packages/connectors/src/index.js";
import { generateSemanticFitnessState } from "../packages/semantic-engine/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function readJson(relativePath) {
  const raw = await readFile(join(rootDir, relativePath), "utf8");
  return JSON.parse(raw);
}

const userContext = await readJson("data/seeds/sample-user-context.json");
const stravaActivity = await readJson("data/fixtures/strava/activity-run.json");

const normalizedWorkout = normalizeStravaActivity(stravaActivity);
const updatedContext = applyNormalizedEventsToContext(userContext, [normalizedWorkout]);
const state = generateSemanticFitnessState(updatedContext, {
  date: "2026-07-23",
  timezone: "Asia/Taipei"
});

console.log(
  JSON.stringify(
    {
      normalizedWorkout,
      semanticFitnessState: state
    },
    null,
    2
  )
);
