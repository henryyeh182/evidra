import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseAppleHealthExport,
  parseAppleHealthExportString,
  normalizeAppleHealthExport,
  applyNormalizedEventsToContext
} from "../src/index.js";
import { appleDateToIso } from "../src/providers/apple-health/normalize.js";
import { generateSemanticFitnessState } from "../../semantic-engine/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "../../../data/fixtures/apple-health/export-sample.xml");

function byType(events, type) {
  return events.filter((event) => event.type === type);
}

test("appleDateToIso converts Apple Health timestamps to ISO 8601", () => {
  assert.equal(appleDateToIso("2026-07-21 07:30:00 +0800"), "2026-07-21T07:30:00+08:00");
});

test("streaming parser and string parser agree on the sample export", async () => {
  const streamed = await parseAppleHealthExport(fixturePath);
  const fromString = parseAppleHealthExportString(await readFile(fixturePath, "utf8"));
  assert.equal(streamed.records.length, fromString.records.length);
  assert.equal(streamed.workouts.length, fromString.workouts.length);
  assert.equal(streamed.workouts.length, 1);
});

test("normalizes point metrics, daily step sums, and per-night sleep", async () => {
  const parsed = await parseAppleHealthExport(fixturePath);
  const events = normalizeAppleHealthExport(parsed);

  assert.deepEqual(byType(events, "hrv_ms").map((e) => e.value), [49, 54]);
  assert.deepEqual(byType(events, "resting_hr_bpm").map((e) => e.value), [58, 56]);

  const steps = byType(events, "steps");
  assert.equal(steps.length, 1, "step records on the same day collapse into one daily sum");
  assert.equal(steps[0].value, 4500);

  const sleep = byType(events, "sleep_duration_hours");
  assert.equal(sleep.length, 1, "asleep intervals sum per night; InBed is excluded");
  assert.equal(sleep[0].value, 7.17); // 3.5h core + 3.667h REM

  for (const event of events) {
    assert.equal(event.source, "apple_health");
    assert.ok(event.id.length > 0);
  }
});

test("normalizes an Apple Health workout with an estimated training load", async () => {
  const parsed = await parseAppleHealthExport(fixturePath);
  const [workout] = normalizeAppleHealthExport(parsed).filter((e) => e.kind === "workout");

  assert.equal(workout.type, "run");
  assert.equal(workout.durationMinutes, 34);
  assert.equal(workout.trainingLoad, 41); // round(34 * 0.6 * 2)
  assert.equal(workout.metadata.rpeEstimated, true);
  assert.deepEqual(workout.muscleGroups, ["legs"]);
});

test("apple health events fold into a user context and drive semantic state", async () => {
  const context = JSON.parse(
    await readFile(join(__dirname, "../../../data/seeds/sample-user-context.json"), "utf8")
  );
  const parsed = await parseAppleHealthExport(fixturePath);
  const merged = applyNormalizedEventsToContext(context, normalizeAppleHealthExport(parsed));

  assert.ok(merged.healthMetrics.length > context.healthMetrics.length);
  const state = generateSemanticFitnessState(merged, { date: "2026-07-22", timezone: "Asia/Taipei" });
  assert.equal(typeof state.readinessScore, "number");
  assert.ok(state.recommendedFocus.length > 0);
});
