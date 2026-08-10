// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildOuraEvidence,
  buildWhoopEvidence,
  normalizeStravaActivity,
  buildGarminEvidence
} from "../src/index.js";
import { CANONICAL_SIGNALS } from "../../evidence/src/index.js";
import { validate } from "../../../eval/lib/jsonSchema.js";

const evidenceSchema = JSON.parse(
  await readFile(new URL("../../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);
const sourceSchemas = {
  oura: JSON.parse(await readFile(new URL("../../../schemas/sources/oura.api.json", import.meta.url), "utf8")),
  whoop: JSON.parse(await readFile(new URL("../../../schemas/sources/whoop.api.json", import.meta.url), "utf8")),
  garmin: JSON.parse(await readFile(new URL("../../../schemas/sources/garmin.export.json", import.meta.url), "utf8")),
  strava: JSON.parse(await readFile(new URL("../../../schemas/sources/strava.api.json", import.meta.url), "utf8"))
};
const oura = JSON.parse(await readFile(new URL("../../../data/fixtures/contracts/oura-api-v2.synthetic.json", import.meta.url), "utf8"));
const whoop = JSON.parse(await readFile(new URL("../../../data/fixtures/contracts/whoop-api-v2.synthetic.json", import.meta.url), "utf8"));
const garmin = JSON.parse(await readFile(new URL("../../../data/fixtures/garmin/export-sample.json", import.meta.url), "utf8"));
const stravaActivity = JSON.parse(await readFile(new URL("../../../data/fixtures/contracts/strava-api.synthetic.json", import.meta.url), "utf8"));

function assertEvidenceContract(evidence, label) {
  const result = validate(evidence, evidenceSchema);
  assert.equal(result.valid, true, `${label}: ${result.errors.join("\\n")}`);
  for (const item of [...(evidence.healthMetrics || []), ...(evidence.vendorAssessments || [])]) {
    assert.ok(CANONICAL_SIGNALS[item.type], `${label}: non-canonical ${item.type}`);
    assert.equal(typeof item.source, "string", `${label}: source label missing`);
    assert.equal(typeof item.unit, "string", `${label}: unit missing for ${item.type}`);
    assert.equal(typeof item.recordedAt, "string", `${label}: timestamp missing for ${item.type}`);
    assert.equal(item.confidence, undefined, `${label}: numeric confidence must not be smuggled into evidence`);
    assert.equal(Number.isNaN(Date.parse(item.recordedAt)), false, `${label}: invalid timestamp`);
  }
  for (const workout of evidence.workouts || []) {
    assert.equal(typeof workout.source, "string", `${label}: workout source label missing`);
    assert.equal(Number.isNaN(Date.parse(workout.startedAt)), false, `${label}: invalid workout timestamp`);
    assert.equal(workout.confidence, undefined, `${label}: workout confidence must not be smuggled into evidence`);
  }
}

test("synthetic Oura API response shape validates and preserves provenance boundaries", () => {
  assert.equal(validate(oura, sourceSchemas.oura).valid, true);
  const evidence = buildOuraEvidence(oura);
  assertEvidenceContract(evidence, "oura");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "hrv_ms").source, "oura");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "hrv_ms").basis, "device_measured");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "sleep_duration_hours").unit, "hours");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "resting_hr_bpm").metadata.derivedFrom, "sleep.lowest_heart_rate");
  assert.equal(evidence.workouts[0].trainingLoad, null);
});

test("synthetic WHOOP API response shape validates and preserves missingness", () => {
  assert.equal(validate(whoop, sourceSchemas.whoop).valid, true);
  const evidence = buildWhoopEvidence(whoop);
  assertEvidenceContract(evidence, "whoop");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "sleep_duration_hours").value, 7);
  assert.equal(evidence.vendorAssessments.find((item) => item.type === "vendor_acute_load").value, 12.1);
  assert.equal(evidence.vendorAssessments.find((item) => item.type === "vendor_acute_load").basis, "vendor_reported");
  assert.equal(evidence.healthMetrics.find((item) => item.type === "sleep_duration_hours").basis, "computed_from_records");
  assert.equal(evidence.workouts[0].trainingLoad, 9.41);
  const missing = buildWhoopEvidence({ ...whoop, recovery: [{ ...whoop.recovery[0], score_state: "PENDING_SCORE", score: undefined }] });
  assert.equal(missing.healthMetrics.some((item) => item.type === "hrv_ms"), false);
  assert.equal(missing.vendorAssessments.some((item) => item.type === "vendor_readiness"), false);
});

test("real-export Garmin shape and Strava API shape keep their source labels and missing values", () => {
  assert.equal(validate(garmin, sourceSchemas.garmin).valid, true);
  assert.equal(validate(stravaActivity, sourceSchemas.strava).valid, true);
  const garminEvidence = buildGarminEvidence(garmin, { asOf: "2026-07-26", sinceDays: 30 });
  assertEvidenceContract(garminEvidence, "garmin");
  const strava = normalizeStravaActivity(stravaActivity);
  assert.equal(strava.source, "strava");
  assert.equal(strava.startedAt, "2026-07-23T06:45:00+08:00");
  assert.equal(strava.rpe, 7, "Strava's suffer_score is explicitly the fallback used by this parser");
  assert.equal(strava.trainingLoad, 68, "Strava's suffer_score remains the per-session load");
  const sparse = normalizeStravaActivity({
    ...stravaActivity,
    id: 9002,
    suffer_score: undefined,
    average_heartrate: undefined,
    max_heartrate: undefined
  });
  assert.equal(sparse.rpe, null, "without an exertion field, RPE remains missing");
  assert.equal(sparse.trainingLoad, null, "without an exertion field, training load remains missing");
});

test("the four contract families preserve units and missingness without inventing confidence", () => {
  const fixtures = [
    ["oura", buildOuraEvidence(oura)],
    ["whoop", buildWhoopEvidence(whoop)],
    ["garmin", buildGarminEvidence(garmin, { asOf: "2026-07-26", sinceDays: 30 })],
    ["strava", { healthMetrics: [], vendorAssessments: [], workouts: [normalizeStravaActivity(stravaActivity)] }]
  ];

  for (const [label, evidence] of fixtures) {
    assertEvidenceContract(evidence, label);
    for (const metric of [...(evidence.healthMetrics || []), ...(evidence.vendorAssessments || [])]) {
      assert.equal(typeof metric.unit, "string", `${label}: unit is required at the normalized boundary`);
      assert.ok(metric.source, `${label}: source provenance is required at the normalized boundary`);
    }
  }

  const noRecovery = buildWhoopEvidence({ recovery: [{ ...whoop.recovery[0], score_state: "PENDING_SCORE" }] });
  assert.equal(noRecovery.healthMetrics.length, 0, "unscored WHOOP recovery must remain missing");
  const noStravaLoad = normalizeStravaActivity({ ...stravaActivity, suffer_score: null, average_heartrate: null, max_heartrate: null });
  assert.equal(noStravaLoad.trainingLoad, null, "Strava without effort evidence must remain unmeasured");
});
