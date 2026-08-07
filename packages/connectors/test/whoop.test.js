// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWhoopEvidence,
  normalizeWhoopRecovery,
  normalizeWhoopSleep,
  normalizeWhoopCycles,
  normalizeWhoopWorkouts
} from "../src/index.js";
import { CANONICAL_SIGNALS, VENDOR_SCHEMAS } from "../../evidence/src/schemaRegistry.js";

const DAY = "2026-07-26";

function sleep(overrides = {}) {
  const { score, ...rest } = overrides;
  return {
    id: "sleep_1",
    cycle_id: 11,
    start: `${DAY}T23:05:00Z`,
    end: `2026-07-27T06:50:00Z`,
    timezone_offset: "+08:00",
    nap: false,
    score_state: "SCORED",
    score: {
      stage_summary: {
        total_in_bed_time_milli: 27900000, // 7h45m in bed
        total_awake_time_milli: 2700000, //   45m awake
        total_no_data_time_milli: 0,
        total_light_sleep_time_milli: 14400000, // 4h00m
        total_slow_wave_sleep_time_milli: 5400000, // 1h30m
        total_rem_sleep_time_milli: 5400000, // 1h30m
        sleep_cycle_count: 5,
        disturbance_count: 3
      },
      sleep_performance_percentage: 88,
      sleep_efficiency_percentage: 90.3,
      ...score
    },
    ...rest
  };
}

function recovery(overrides = {}) {
  const { score, ...rest } = overrides;
  return {
    cycle_id: 11,
    sleep_id: "sleep_1",
    created_at: `2026-07-27T07:00:00Z`,
    updated_at: `2026-07-27T07:00:00Z`,
    score_state: "SCORED",
    score: {
      user_calibrating: false,
      recovery_score: 63,
      resting_heart_rate: 54,
      hrv_rmssd_milli: 41.813562,
      ...score
    },
    ...rest
  };
}

test("sleep duration is the three stages summed, never the time spent in bed", () => {
  const [duration] = normalizeWhoopSleep([sleep()]).filter((e) => e.type === "sleep_duration_hours");

  // 4h + 1h30 + 1h30 = 7h asleep, against 7h45m in bed.
  assert.equal(duration.value, 7);
  assert.equal(duration.unit, "hours");
  assert.equal(duration.metadata.derivedFrom, "light + slow_wave + rem");
  assert.equal(duration.metadata.inBedMinutes, 465);
  assert.notEqual(duration.value, 7.75, "in-bed time would have overstated the night by 45 minutes");
});

test("an unscored record contributes nothing rather than zeroes", () => {
  const pending = [
    ...normalizeWhoopSleep([{ ...sleep(), score_state: "PENDING_SCORE", score: undefined }]),
    ...normalizeWhoopRecovery([{ ...recovery(), score_state: "PENDING_SCORE", score: undefined }]),
    ...normalizeWhoopCycles([
      { id: 11, start: `${DAY}T00:00:00Z`, score_state: "UNSCORABLE", score: undefined }
    ])
  ];

  assert.deepEqual(pending, [], "a night of no sleep and a day of no strain are the wrong readings to invent");
});

test("naps are excluded from the night", () => {
  const events = normalizeWhoopSleep([sleep({ nap: true })]);
  assert.deepEqual(events, []);
});

test("recovery keeps the measurements while calibrating, but withholds the composite", () => {
  const events = normalizeWhoopRecovery([recovery({ score: { user_calibrating: true } })]);
  const types = events.map((event) => event.type);

  assert.ok(types.includes("hrv_ms"), "HRV is a measurement and stays");
  assert.ok(types.includes("resting_hr_bpm"));
  assert.ok(
    !types.includes("vendor_readiness"),
    "WHOOP itself says the score is not accurate yet; laundering it into confidence is the failure"
  );
});

test("HRV arrives in milliseconds with its method named", () => {
  const [hrv] = normalizeWhoopRecovery([recovery()]).filter((event) => event.type === "hrv_ms");
  assert.equal(hrv.value, 41.8);
  assert.equal(hrv.unit, "ms");
  assert.equal(hrv.metadata.method, "rmssd");
  assert.equal(hrv.source, "whoop");
});

test("strain is carried on WHOOP's own scale, and a live cycle says it is unfinished", () => {
  const [finished] = normalizeWhoopCycles([
    { id: 11, start: `${DAY}T00:00:00Z`, end: `2026-07-27T00:00:00Z`, score_state: "SCORED", score: { strain: 14.7382 } }
  ]);
  assert.equal(finished.value, 14.74);
  assert.equal(finished.unit, "load");
  assert.equal(finished.metadata.scale, "0-21");
  assert.equal(finished.metadata.inProgress, false);

  const [live] = normalizeWhoopCycles([
    { id: 12, start: `2026-07-27T00:00:00Z`, score_state: "SCORED", score: { strain: 5.2 } }
  ]);
  assert.equal(live.metadata.inProgress, true);
});

test("an unscored workout gets no load instead of an estimate from its duration", () => {
  const [scored, unscored] = normalizeWhoopWorkouts([
    {
      id: "w1",
      sport_name: "running",
      start: `${DAY}T06:00:00Z`,
      end: `${DAY}T07:00:00Z`,
      score_state: "SCORED",
      score: { strain: 9.4123, average_heart_rate: 148, max_heart_rate: 171, percent_recorded: 99 }
    },
    {
      id: "w2",
      sport_name: "weightlifting",
      start: `${DAY}T17:00:00Z`,
      end: `${DAY}T18:00:00Z`,
      score_state: "PENDING_SCORE"
    }
  ]);

  assert.equal(scored.type, "run");
  assert.equal(scored.trainingLoad, 9.41);
  assert.equal(scored.metadata.loadSource, "whoop_strain_0_21");
  assert.equal(scored.metadata.percentRecorded, 99);

  assert.equal(unscored.type, "strength");
  assert.equal(unscored.durationMinutes, 60);
  assert.equal(unscored.trainingLoad, null);
  assert.equal(unscored.metadata.loadSource, "none_unscored_workout");
});

test("every signal the registry declares for WHOOP is produced by a complete set of documents", () => {
  const evidence = buildWhoopEvidence({
    recovery: [recovery()],
    sleep: [sleep()],
    cycles: [
      { id: 11, start: `${DAY}T00:00:00Z`, end: `2026-07-27T00:00:00Z`, score_state: "SCORED", score: { strain: 12.1 } }
    ]
  });

  const produced = new Set([
    ...evidence.healthMetrics.map((metric) => metric.type),
    ...evidence.vendorAssessments.map((item) => item.type)
  ]);

  for (const mapping of VENDOR_SCHEMAS.whoop.signals) {
    assert.ok(produced.has(mapping.to), `registry declares ${mapping.to} but the parser never produced it`);
  }

  for (const metric of evidence.healthMetrics) {
    assert.ok(CANONICAL_SIGNALS[metric.type], `${metric.type} is not a canonical signal`);
    assert.equal(metric.source, "whoop");
  }
});
