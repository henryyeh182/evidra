// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStravaActivity, STRAVA_TYPE_MAP } from "../src/providers/strava/normalizeActivity.js";
import { normalizeStravaExportActivity } from "../src/providers/strava/normalizeExport.js";

/**
 * The same ride, written twice.
 *
 * Strava reaches this system through two dialects: the OAuth API, and the bulk
 * data export the athlete downloads. They were tested separately — each against
 * its own contract — and nothing asserted that they agree with each other. A
 * decision does not know which door its evidence came through, so a session
 * that yields a training load of 46 through one and 92 through the other is a
 * silent fork in the athlete's history.
 *
 * The API's `suffer_score` and the export's `Relative Effort` are the same
 * quantity under two names, which is what makes the comparison possible at all.
 *
 * Only the decision-bearing fields are compared. `metadata` deliberately
 * differs: the export knows things the API does not (which dialect, whether a
 * timezone was recovered, what the load and RPE stood on) and the API carries
 * things the export drops. Demanding identity there would be demanding the two
 * sources forget what each of them knows.
 */

const ACTIVITY_ID = 20579309232;
const STARTED_AT = "2026-07-25T10:56:26Z";

/** As the OAuth API returns it. */
const apiActivity = (overrides = {}) => ({
  id: ACTIVITY_ID,
  name: "Evening Run",
  type: "Run",
  start_date: STARTED_AT,
  moving_time: 2227,
  elapsed_time: 2321,
  distance: 7204.3,
  total_elevation_gain: 41,
  average_heartrate: 136,
  max_heartrate: 158,
  average_speed: 3.235,
  suffer_score: 50,
  ...overrides
});

/** The same activity as a parsed row of `activities.csv`. */
const exportActivity = (overrides = {}) => ({
  activityId: String(ACTIVITY_ID),
  name: "Evening Run",
  activityType: "Run",
  startedAtUtc: STARTED_AT,
  timezoneKnown: false,
  movingSeconds: 2227,
  elapsedSeconds: 2321,
  distanceMeters: 7204.3,
  elevationGainMeters: 41,
  averageHeartRate: 136,
  maxHeartRate: 158,
  averageSpeedMetersPerSecond: 3.235,
  relativeEffort: 50,
  perceivedExertion: null,
  ...overrides
});

/** What a decision reads. Everything else is dialect-specific by design. */
function decisionBearing(event) {
  return {
    id: event.id,
    sourceRecordId: event.sourceRecordId,
    source: event.source,
    type: event.type,
    startedAt: event.startedAt,
    durationMinutes: event.durationMinutes,
    trainingLoad: event.trainingLoad,
    rpe: event.rpe,
    muscleGroups: event.muscleGroups
  };
}

/**
 * The export side is normalized with `anchors: null` on purpose.
 *
 * With an athlete maximum available the export infers RPE against that, while
 * the API only ever has the session's own peak. Those are different questions,
 * and the export is right to prefer the better one. Withholding the anchors
 * puts both dialects on the same input, which is the only way to test the
 * translation rather than the extra evidence one side happens to hold.
 */
const normalizeBoth = (overrides = {}) => ({
  api: normalizeStravaActivity(apiActivity(overrides.api)),
  export: normalizeStravaExportActivity(exportActivity(overrides.export), { anchors: null })
});

test("the same activity normalizes identically through both Strava dialects", () => {
  const { api, export: fromExport } = normalizeBoth();

  assert.deepEqual(decisionBearing(fromExport), decisionBearing(api));
});

test("both dialects put the same session on the same load scale", () => {
  // suffer_score and Relative Effort are one quantity under two names. If this
  // ever diverges, an athlete's ATL/CTL depends on which door their history
  // came through.
  const { api, export: fromExport } = normalizeBoth();

  assert.equal(api.trainingLoad, 50);
  assert.equal(fromExport.trainingLoad, 50);
});

test("both dialects agree across the heart-rate range where they share a rule", () => {
  // Sampled at each rung and one beat below it, not in the middle of the bands.
  // Mid-band samples pass while a threshold moves underneath them: shifting the
  // export's 0.72 rung to 0.70 changed no answer at a ratio of 0.734, so the
  // check read green against a dialect that had genuinely drifted. Boundaries
  // are the only place a threshold change is visible.
  //
  // A maximum of 200 keeps the arithmetic exact. 0.62 is the lowest rung the
  // shared ladder covers; below it the dialects deliberately part company.
  const MAX_HR = 200;
  for (const averageHr of [176, 175, 160, 159, 144, 143, 124]) {
    const { api, export: fromExport } = normalizeBoth({
      api: { average_heartrate: averageHr, max_heartrate: MAX_HR },
      export: { averageHeartRate: averageHr, maxHeartRate: MAX_HR }
    });

    assert.equal(
      fromExport.rpe,
      api.rpe,
      `at ${averageHr}/${MAX_HR} (${(averageHr / MAX_HR).toFixed(3)}) the export read RPE ${fromExport.rpe} and the API ${api.rpe}`
    );
  }
});

test("every sport type in the shared map lands on the same domain type in both dialects", () => {
  // Today this cannot fail: there is one STRAVA_TYPE_MAP, defined alongside the
  // API normalizer and imported by the export one, so editing an entry moves
  // both dialects together. Verified by trying — changing Hike to "recovery"
  // leaves every assertion here green, because both sides read the same table.
  //
  // So this pins the sharing rather than the mapping. The refactor it is
  // waiting for is the plausible one: the API gains a sport the export spells
  // differently, someone gives one normalizer its own copy, and the two
  // dialects begin answering differently for types nobody thought to re-test.
  // Keeping it is cheap; the day it fails is the day it was worth writing.
  for (const stravaType of Object.keys(STRAVA_TYPE_MAP)) {
    const { api, export: fromExport } = normalizeBoth({
      api: { type: stravaType },
      export: { activityType: stravaType }
    });

    assert.equal(
      fromExport.type,
      api.type,
      `${stravaType} became ${fromExport.type} through the export and ${api.type} through the API`
    );
    assert.deepEqual(fromExport.muscleGroups, api.muscleGroups, `${stravaType} disagreed on muscle groups`);
  }
});

test("an unmapped sport type falls back the same way in both dialects", () => {
  const { api, export: fromExport } = normalizeBoth({
    api: { type: "Kitesurf" },
    export: { activityType: "Kitesurf" }
  });

  assert.equal(fromExport.type, "recovery");
  assert.equal(api.type, "recovery");
});

test("below the shared ladder the two dialects differ, and the difference is pinned", () => {
  // Not an equivalence: an easy session at 0.5 of maximum reads 4 through the
  // export and falls through to the suffer-score tiers through the API. Both
  // behaviours are defensible in isolation and neither is changed here —
  // asserting it stops the gap widening unnoticed, and stops a future reader
  // assuming the dialects agree everywhere because one test said they agree.
  const { api, export: fromExport } = normalizeBoth({
    api: { average_heartrate: 79, max_heartrate: 158, suffer_score: 50 },
    export: { averageHeartRate: 79, maxHeartRate: 158, relativeEffort: 50 }
  });

  assert.equal(fromExport.rpe, 4, "the export's floor moved");
  assert.equal(api.rpe, 6, "the API's suffer-score fallback moved");
  assert.notEqual(fromExport.rpe, api.rpe);

  // The load is what a decision actually computes on, and it must still agree.
  assert.equal(fromExport.trainingLoad, api.trainingLoad);
});

test("a reported exertion is honoured identically by both dialects", () => {
  const { api, export: fromExport } = normalizeBoth({
    api: { perceived_exertion: 7 },
    export: { perceivedExertion: 7 }
  });

  assert.equal(api.rpe, 7);
  assert.equal(fromExport.rpe, 7);
});

test("a recovered timezone changes the export's day, and that is not a divergence", () => {
  // The export can know the athlete's offset; the API always states one. When
  // the export has recovered it, `startedAt` legitimately reads as a local
  // instant rather than a Z one — same moment, better answer.
  const withOffset = normalizeStravaExportActivity(
    exportActivity({
      timezoneKnown: true,
      startedAtLocal: "2026-07-25T18:56:26+08:00",
      utcOffsetSeconds: 28800
    }),
    { anchors: null }
  );

  assert.equal(withOffset.startedAt, "2026-07-25T18:56:26+08:00");
  assert.equal(
    new Date(withOffset.startedAt).toISOString(),
    new Date(STARTED_AT).toISOString(),
    "the two spellings do not name the same instant"
  );
});
