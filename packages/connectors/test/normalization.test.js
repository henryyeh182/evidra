import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyNormalizedEventsToContext } from "../src/index.js";
import { normalizeStravaActivity } from "../src/providers/strava/index.js";
import { generateSemanticFitnessState } from "../../semantic-engine/src/index.js";

const context = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);
const activity = JSON.parse(
  await readFile(new URL("../../../data/fixtures/strava/activity-run.json", import.meta.url), "utf8")
);

test("applyNormalizedEventsToContext adds normalized Strava workouts to the user context", () => {
  const event = normalizeStravaActivity(activity);
  const updatedContext = applyNormalizedEventsToContext(context, [event]);

  assert.equal(updatedContext.workouts.length, context.workouts.length + 1);
  assert.equal(updatedContext.workouts.at(-1).id, "strava_1234567890");
  assert.equal(updatedContext.workouts.at(-1).sourceRecordId, "1234567890");
});

test("normalized Strava workout changes semantic fitness state training load", () => {
  const before = generateSemanticFitnessState(context, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  const event = normalizeStravaActivity(activity);
  const updatedContext = applyNormalizedEventsToContext(context, [event]);
  const after = generateSemanticFitnessState(updatedContext, {
    date: "2026-07-23",
    timezone: "Asia/Taipei"
  });

  assert.equal(before.trainingLoad7d, 198);
  assert.equal(after.trainingLoad7d, 266);
  assert.ok(after.muscleFatigue.legs > before.muscleFatigue.legs);
});
