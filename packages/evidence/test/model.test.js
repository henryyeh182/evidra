// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertValidEvidence,
  evidenceToUserContext,
  describeEvidence,
  EVIDENCE_VENDOR_ASSESSMENT_TYPES,
  EVIDENCE_VALUE_BASES
} from "../src/index.js";

const evidence = {
  profile: { timezone: "Asia/Taipei", fitnessLevel: "advanced" },
  goals: [{ id: "g1", type: "half_marathon", priority: 1 }],
  constraints: {
    availableMinutes: 60,
    equipment: ["treadmill", "dumbbell"],
    injuries: [{ bodyRegion: "left_knee", restrictions: ["avoid high-impact jumping"], status: "active" }],
    avoidMovements: ["burpees"]
  },
  healthMetrics: [{ type: "hrv_ms", value: 38, recordedAt: "2026-07-27T06:00:00+08:00", source: "garmin" }],
  workouts: [
    {
      type: "run",
      startedAt: "2026-07-26T18:00:00+08:00",
      durationMinutes: 70,
      rpe: 8,
      trainingLoad: 112,
      muscleGroups: ["legs"],
      source: "garmin"
    }
  ]
};

test("evidence maps to a usable context without the server holding any data", () => {
  const context = evidenceToUserContext(evidence, { userId: "external_user" });

  assert.equal(context.user.id, "external_user");
  assert.equal(context.user.timezone, "Asia/Taipei");
  assert.equal(context.goals[0].type, "half_marathon");
  assert.equal(context.injuries[0].status, "active");
  assert.equal(context.equipment[0].type, "treadmill");
  assert.equal(context.healthMetrics[0].value, 38);
  assert.equal(context.workouts[0].trainingLoad, 112);
});

test("constraints become the preferences the engines read", () => {
  const context = evidenceToUserContext(evidence);
  const schedule = context.preferences.find((item) => item.key === "weekday_available_minutes");
  const avoid = context.preferences.find((item) => item.category === "avoid");

  assert.equal(schedule.value, 60);
  assert.deepEqual(avoid.value, ["burpees"]);
});

test("partial evidence still produces a context, gaps left visible", () => {
  const context = evidenceToUserContext({ healthMetrics: [], workouts: [] });

  assert.equal(context.workouts.length, 0);
  assert.equal(context.healthMetrics.length, 0);
  assert.ok(context.user.timezone, "a default timezone keeps date math well-defined");
});

test("unknown metric types are rejected rather than silently ignored", () => {
  assert.throws(
    () => assertValidEvidence({ healthMetrics: [{ type: "vo2max", value: 50, recordedAt: "2026-07-27" }] }),
    /Unknown evidence metric type/
  );
});

// The vendor composite is the reading the recovery score weights highest, and
// it was the one field nothing validated. A misspelt type passed, the engine
// found no composite, and the caller's strongest signal was reported back as
// missing — a wrong answer that looked like a well-covered one.
test("an unknown vendor assessment type is rejected rather than silently ignored", () => {
  assert.throws(
    () =>
      assertValidEvidence({
        vendorAssessments: [{ type: "bodyBattery", value: 24, recordedAt: "2026-08-06T06:00:00Z" }]
      }),
    /Unknown evidence vendor assessment type/
  );
});

test("a vendor assessment without a value or timestamp is rejected", () => {
  assert.throws(
    () => assertValidEvidence({ vendorAssessments: [{ type: "body_battery", value: "low", recordedAt: "2026-08-06" }] }),
    /numeric value/
  );
});

test("the vendor assessment vocabulary is the one the engine reads", () => {
  // Both halves matter: a type the schema advertises but the engine ignores is
  // a promise the caller cannot collect on.
  assert.deepEqual(
    [...EVIDENCE_VENDOR_ASSESSMENT_TYPES],
    ["vendor_readiness", "body_battery", "recovery_time_minutes", "vendor_acute_load"]
  );
  for (const type of EVIDENCE_VENDOR_ASSESSMENT_TYPES) {
    assert.doesNotThrow(
      () => assertValidEvidence({ vendorAssessments: [{ type, value: 50, recordedAt: "2026-08-06T06:00:00Z" }] }),
      `${type} is advertised but rejected`
    );
  }
});

test("a metric without a value or timestamp is rejected", () => {
  assert.throws(
    () => assertValidEvidence({ healthMetrics: [{ type: "hrv_ms", value: "low", recordedAt: "2026-07-27" }] }),
    /numeric value/
  );
});

test("evidence basis is an enum, not an unauditable scalar", () => {
  assert.deepEqual(
    [...EVIDENCE_VALUE_BASES],
    [
      "device_measured",
      "vendor_reported",
      "user_reported",
      "computed_from_records",
      "derived_from_synced_source",
      "unstated"
    ]
  );
  assert.doesNotThrow(() =>
    assertValidEvidence({
      healthMetrics: [
        {
          type: "hrv_ms",
          value: 42,
          recordedAt: "2026-08-06T06:00:00Z",
          basis: "device_measured"
        }
      ]
    })
  );
});

test("numeric evidence quality or confidence is rejected", () => {
  assert.throws(
    () =>
      assertValidEvidence({
        healthMetrics: [{ type: "hrv_ms", value: 42, recordedAt: "2026-08-06T06:00:00Z", quality: 0.94 }]
      }),
    /quality\/confidence.*basis/i
  );
  assert.throws(
    () =>
      assertValidEvidence({
        healthMetrics: [{ type: "hrv_ms", value: 42, recordedAt: "2026-08-06T06:00:00Z", confidence: 0.9 }]
      }),
    /quality\/confidence.*basis/i
  );
});

test("evidence basis travels into context and provenance", () => {
  const input = {
    healthMetrics: [
      {
        type: "sleep_duration_hours",
        value: 7.5,
        recordedAt: "2026-08-06T06:00:00Z",
        source: "apple_health",
        basis: "computed_from_records"
      }
    ]
  };

  const context = evidenceToUserContext(input);
  const summary = describeEvidence(input);

  assert.equal(context.healthMetrics[0].basis, "computed_from_records");
  assert.deepEqual(summary.signalBases.sleep_duration_hours, { computed_from_records: 1 });
});

test("describeEvidence reports what actually arrived", () => {
  const summary = describeEvidence(evidence);

  assert.equal(summary.metricCount, 1);
  assert.equal(summary.workoutCount, 1);
  assert.deepEqual(summary.metricTypes, ["hrv_ms"]);
  assert.equal(summary.latest, "2026-07-27T06:00:00+08:00");
});

test("the source a caller stated is reported back, separately from the writer", () => {
  const summary = describeEvidence({
    healthMetrics: [
      { type: "hrv_ms", value: 41, recordedAt: "2026-08-04T00:10:00Z", source: "garmin" },
      // Same signal, second source: a caller merging two connectors gets both
      // back rather than whichever happened to be last.
      { type: "hrv_ms", value: 44, recordedAt: "2026-08-03T00:10:00Z", source: "apple_health" },
      // A reading with no stated source leaves the list as it is; it does not
      // become an entry saying "unknown".
      { type: "steps", value: 8200, recordedAt: "2026-08-04T00:00:00Z" }
    ]
  });

  assert.deepEqual(summary.signalWriters.hrv_ms.sources, ["apple_health", "garmin"]);
  assert.deepEqual(summary.signalWriters.steps.sources, []);

  // `writers` stays a separate question — which device inside a source recorded
  // the reading — and only connector metadata answers it. Reporting only this
  // one was what made a caller's own `source` read back as an empty list.
  assert.deepEqual(summary.signalWriters.hrv_ms.writers, []);
});

test("a session that arrived without a load is carried as unmeasured", () => {
  const context = evidenceToUserContext({
    workouts: [{ type: "strength", startedAt: "2026-07-26T18:00:00+08:00", durationMinutes: 45 }]
  });

  // Not 45. A load derived from duration reads downstream as a measured load,
  // and `signalCoverage.training` could then never report the gap.
  assert.equal(context.workouts[0].trainingLoad, null);
});

test("provenance says what each session's load stood on", () => {
  const summary = describeEvidence({
    workouts: [
      {
        type: "run",
        startedAt: "2026-07-25T08:00:00+08:00",
        durationMinutes: 60,
        trainingLoad: 120,
        metadata: { loadSource: "relative_effort", rpeBasis: "athlete_max_hr_age_estimate" }
      },
      {
        type: "run",
        startedAt: "2026-07-24T08:00:00+08:00",
        durationMinutes: 40,
        trainingLoad: 70,
        metadata: { loadSource: "relative_effort", rpeBasis: "reported" }
      },
      {
        type: "strength",
        startedAt: "2026-07-23T08:00:00+08:00",
        durationMinutes: 45,
        metadata: { loadSource: "unavailable", rpeBasis: "unavailable" }
      }
    ]
  });

  assert.deepEqual(summary.loadSources, { relative_effort: 2, unavailable: 1 });
  assert.deepEqual(summary.rpeBasis, {
    athlete_max_hr_age_estimate: 1,
    reported: 1,
    unavailable: 1
  });
});

test("a source that said nothing is not folded into one that said 'none'", () => {
  const summary = describeEvidence({
    workouts: [
      { type: "run", startedAt: "2026-07-25T08:00:00+08:00", durationMinutes: 60, trainingLoad: 120 },
      {
        type: "strength",
        startedAt: "2026-07-24T08:00:00+08:00",
        durationMinutes: 45,
        metadata: { loadSource: "unavailable" }
      }
    ]
  });

  // The first session carries a load with no stated origin — silence, not a
  // finding of "no load available".
  assert.deepEqual(summary.loadSources, { unstated: 1, unavailable: 1 });
  assert.deepEqual(summary.rpeBasis, { unstated: 2 });
});

test("an estimated RPE with no named basis is still not counted as reported", () => {
  const summary = describeEvidence({
    workouts: [
      {
        type: "run",
        startedAt: "2026-07-25T08:00:00+08:00",
        durationMinutes: 60,
        rpe: 7,
        metadata: { rpeEstimated: true }
      }
    ]
  });

  assert.deepEqual(summary.rpeBasis, { estimated: 1 });
});

test("evidence with no sessions claims nothing about loads", () => {
  const summary = describeEvidence({ healthMetrics: [], workouts: [] });

  assert.equal("loadSources" in summary, false);
  assert.equal("rpeBasis" in summary, false);
});
