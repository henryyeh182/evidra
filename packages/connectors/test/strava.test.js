import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeStravaActivity } from "../src/providers/strava/index.js";

const activity = JSON.parse(
  await readFile(new URL("../../../data/fixtures/strava/activity-run.json", import.meta.url), "utf8")
);

test("normalizeStravaActivity converts a Strava run into a normalized workout event", () => {
  const event = normalizeStravaActivity(activity);

  assert.deepEqual(event, {
    kind: "workout",
    id: "strava_1234567890",
    sourceRecordId: "1234567890",
    source: "strava",
    type: "run",
    name: "Morning Zone 2 Run",
    startedAt: "2026-07-23T06:45:00+08:00",
    durationMinutes: 41,
    rpe: 7,
    trainingLoad: 68,
    muscleGroups: ["legs"],
    metadata: {
      distanceMeters: 7200,
      elevationGainMeters: 42,
      averageHeartRate: 142,
      maxHeartRate: 176,
      averageSpeedMetersPerSecond: 2.93,
      kudosCount: 3
    }
  });
});
