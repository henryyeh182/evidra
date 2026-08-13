// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { GarminLocalConnector } from "../../src/local/garminLocal.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../../../data/fixtures/garmin/di-connect-export", import.meta.url));

test("GarminLocalConnector bridges the real 'Export Your Data' archive dialect", async () => {
  const connector = new GarminLocalConnector({ baseDir: FIXTURE_DIR });
  const events = await connector.pullNormalizedEvents();

  // Sleep duration has no direct field in this dialect — it is
  // deepSleepSeconds + lightSleepSeconds + remSleepSeconds (3600+10800+7200=21600s).
  const sleepDuration = events.find((e) => e.type === "sleep_duration_hours");
  assert.ok(sleepDuration, "sleep_duration_hours should be derived from the stage seconds");
  assert.equal(sleepDuration.value, 6);

  // Sleep score sits at sleepScores.overallScore in this dialect, not
  // sleepScores.overall.value.
  const sleepQuality = events.find((e) => e.type === "sleep_quality");
  assert.equal(sleepQuality.value, 81);

  // Stress is nested under allDayStress.aggregatorList; only the TOTAL
  // segment (22) is the whole-day figure, not ASLEEP (10) or AWAKE (28).
  const stressOn21 = events.find((e) => e.type === "stress" && e.recordedAt.startsWith("2026-07-21"));
  assert.equal(stressOn21.value, 22);

  // 2026-07-22's TOTAL entry is the -1 not-measured sentinel and its
  // restingHeartRate is the 0 sentinel — both must be filtered out, not
  // passed through as real readings.
  assert.equal(events.some((e) => e.type === "stress" && e.recordedAt.startsWith("2026-07-22")), false);
  assert.equal(events.some((e) => e.type === "resting_hr_bpm" && e.recordedAt.startsWith("2026-07-22")), false);

  // Body Battery and recovery_time_minutes are vendor_assessment kind and
  // must survive the flattening (they used to be silently dropped by
  // applyNormalizedEventsToContext before it learned this kind).
  assert.ok(events.some((e) => e.kind === "vendor_assessment" && e.type === "body_battery"));
  assert.ok(events.some((e) => e.kind === "vendor_assessment" && e.type === "recovery_time_minutes"));

  const workout = events.find((e) => e.kind === "workout");
  assert.equal(workout.type, "run");
  assert.equal(workout.trainingLoad, 63); // Math.round(activityTrainingLoad 62.5)
});

test("GarminLocalConnector returns no events when the archive folder does not exist", async () => {
  const connector = new GarminLocalConnector({ baseDir: fileURLToPath(new URL("../../../../data/fixtures/does-not-exist", import.meta.url)) });
  assert.deepEqual(await connector.pullNormalizedEvents(), []);
});
