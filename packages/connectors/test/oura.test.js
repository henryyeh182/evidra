// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { buildOuraEvidence, normalizeOuraSleep, normalizeOuraWorkouts } from "../src/index.js";
import { CANONICAL_SIGNALS, VENDOR_SCHEMAS } from "../../evidence/src/schemaRegistry.js";

const DAY = "2026-07-26";

/** A night as Oura's sleep endpoint returns it. */
function night(overrides = {}) {
  return {
    id: "sleep_1",
    day: DAY,
    type: "long_sleep",
    bedtime_start: `${DAY}T23:10:00+08:00`,
    bedtime_end: `${DAY}T07:05:00+08:00`,
    total_sleep_duration: 26100,
    time_in_bed: 28500,
    average_hrv: 48,
    lowest_heart_rate: 52,
    average_heart_rate: 58,
    efficiency: 91,
    low_battery_alert: false,
    ...overrides
  };
}

test("the measurement document supplies duration, HRV and the resting-HR proxy", () => {
  const events = normalizeOuraSleep([night()]);
  const byType = Object.fromEntries(events.map((event) => [event.type, event]));

  assert.equal(byType.sleep_duration_hours.value, 7.25);
  assert.equal(byType.sleep_duration_hours.unit, "hours");
  assert.equal(byType.hrv_ms.value, 48);
  assert.equal(byType.hrv_ms.unit, "ms");
  assert.equal(byType.resting_hr_bpm.value, 52);

  for (const event of events) {
    assert.equal(event.source, "oura");
    assert.ok(CANONICAL_SIGNALS[event.type], `${event.type} is not a canonical signal`);
  }
});

test("the resting-HR reading says it is our proxy, because Oura publishes no such field", () => {
  const [restingHr] = normalizeOuraSleep([night()]).filter((event) => event.type === "resting_hr_bpm");
  assert.equal(restingHr.metadata.derivedFrom, "sleep.lowest_heart_rate");
  assert.match(restingHr.metadata.note, /no resting heart rate/i);
});

test("only long_sleep counts as a night — naps and rejected periods never add to duration", () => {
  const periods = [
    night({ id: "nap", type: "sleep", total_sleep_duration: 3600 }),
    night({ id: "late", type: "late_nap", total_sleep_duration: 2700 }),
    night({ id: "rejected", type: "rest", total_sleep_duration: 5400 }),
    night({ id: "gone", type: "deleted", total_sleep_duration: 25200 }),
    night({ id: "real", type: "long_sleep", total_sleep_duration: 26100 })
  ];

  const durations = normalizeOuraSleep(periods).filter((event) => event.type === "sleep_duration_hours");
  assert.equal(durations.length, 1, "four of the five periods are not a night");
  assert.equal(durations[0].value, 7.25);
});

test("a night Oura could not measure produces no reading rather than a zero", () => {
  const events = normalizeOuraSleep([
    night({ average_hrv: null, lowest_heart_rate: null, total_sleep_duration: null })
  ]);
  assert.deepEqual(events, []);
});

test("a contributor score can never arrive as hrv_ms", () => {
  // The shape of the bug this parser was written to make impossible: the
  // readiness contributors object carries hrv_balance in [1, 100], which sits
  // inside the plausible range for HRV in milliseconds.
  const evidence = buildOuraEvidence({
    sleep: [night({ average_hrv: null })],
    dailyReadiness: [{ day: DAY, score: 74, contributors: { hrv_balance: 61, resting_heart_rate: 88 } }]
  });

  const hrv = evidence.healthMetrics.filter((metric) => metric.type === "hrv_ms");
  assert.equal(hrv.length, 0, "hrv_balance must not be read as a millisecond HRV");

  const readiness = evidence.vendorAssessments.find((item) => item.type === "vendor_readiness");
  assert.equal(readiness.value, 74);
});

test("workouts carry no training load, because Oura computes none", () => {
  const [workout] = normalizeOuraWorkouts([
    {
      id: "w1",
      activity: "running",
      start_datetime: `${DAY}T06:00:00+08:00`,
      end_datetime: `${DAY}T06:45:00+08:00`,
      intensity: "moderate",
      calories: 410,
      distance: 8200
    }
  ]);

  assert.equal(workout.type, "run");
  assert.equal(workout.durationMinutes, 45);
  assert.equal(workout.trainingLoad, null, "a load we invented would be indistinguishable from a measured one");
  assert.equal(workout.metadata.loadSource, "none_oura_publishes_no_load");
  assert.equal(workout.metadata.intensity, "moderate");
  assert.equal(workout.rpe, null);
});

test("every signal the registry declares for Oura is produced by a complete set of documents", () => {
  const evidence = buildOuraEvidence({
    sleep: [night()],
    dailySleep: [{ day: DAY, score: 82, contributors: { total_sleep: 90 } }],
    dailyReadiness: [{ day: DAY, score: 74 }],
    dailyActivity: [{ day: DAY, steps: 9400, score: 88 }]
  });

  const produced = new Set([
    ...evidence.healthMetrics.map((metric) => metric.type),
    ...evidence.vendorAssessments.map((item) => item.type)
  ]);

  for (const mapping of VENDOR_SCHEMAS.oura.signals) {
    assert.ok(produced.has(mapping.to), `registry declares ${mapping.to} but the parser never produced it`);
  }
});
