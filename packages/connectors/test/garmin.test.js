import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildGarminEvidence } from "../src/providers/garmin/index.js";
import { VENDOR_SCHEMAS, CANONICAL_SIGNALS } from "../../evidence/src/index.js";
import { validate } from "../../../eval/lib/jsonSchema.js";

const rawExport = JSON.parse(
  await readFile(new URL("../../../data/fixtures/garmin/export-sample.json", import.meta.url), "utf8")
);
const sourceSchema = JSON.parse(
  await readFile(new URL("../../../schemas/sources/garmin.export.json", import.meta.url), "utf8")
);
const evidenceSchema = JSON.parse(
  await readFile(new URL("../../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);

const ASOF = "2026-07-26";
const evidence = buildGarminEvidence(rawExport, { asOf: ASOF, sinceDays: 30 });

const metricsOn = (type, day) =>
  evidence.healthMetrics.filter((metric) => metric.type === type && metric.recordedAt.startsWith(day));
const assessmentsOn = (type, day) =>
  evidence.vendorAssessments.filter((item) => item.type === type && item.recordedAt.startsWith(day));

test("the fixture is a legal Garmin export by our own source schema", () => {
  const result = validate(rawExport, sourceSchema);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("normalized Garmin evidence satisfies the Fitness Evidence Model", () => {
  const result = validate(evidence, evidenceSchema);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("every signal the registry declares for Garmin is actually parsed", () => {
  // The mapping table is the layer's promise to the rest of the system. A
  // signal listed there but never emitted is a promise the parser cannot keep.
  const declared = [...new Set(VENDOR_SCHEMAS.garmin.signals.map((mapping) => mapping.to))];
  const produced = new Set([
    ...evidence.healthMetrics.map((metric) => metric.type),
    ...evidence.vendorAssessments.map((item) => item.type)
  ]);

  assert.deepEqual(
    declared.filter((signal) => !produced.has(signal)),
    [],
    "declared in schemaRegistry but never produced by the parser"
  );
});

test("emitted signals carry canonical names, units and their source label", () => {
  for (const metric of [...evidence.healthMetrics, ...evidence.vendorAssessments]) {
    const spec = CANONICAL_SIGNALS[metric.type];
    assert.ok(spec, `${metric.type} is not part of the canonical vocabulary`);
    assert.equal(metric.unit, spec.unit, `${metric.type} unit`);
    assert.equal(metric.source, "garmin");
  }
});

test("Garmin's units are converted, not passed through", () => {
  // 26280s is 7.3h, and a 3120000ms activity is 52 minutes.
  assert.equal(metricsOn("sleep_duration_hours", "2026-07-22")[0].value, 7.3);

  const run = evidence.workouts.find((workout) => workout.name === "Zone 2 Run");
  assert.equal(run.durationMinutes, 52);
  assert.equal(run.startedAt, "2026-07-22T07:00:00.000Z");
  assert.equal(run.type, "run");
});

test("a night without the watch produces no sleep evidence at all", () => {
  // 2026-07-23 has no sleep record. Nothing may be interpolated for it.
  assert.equal(metricsOn("sleep_duration_hours", "2026-07-23").length, 0);
  assert.equal(metricsOn("sleep_quality", "2026-07-23").length, 0);
});

test("a night timed but not scored yields duration without an invented quality", () => {
  assert.equal(metricsOn("sleep_duration_hours", "2026-07-25")[0].value, 8.1);
  assert.equal(metricsOn("sleep_quality", "2026-07-25").length, 0);
});

test("not-measured sentinels never become physiology", () => {
  // restingHeartRate 0 and averageStressLevel -1 mean "no reading", not a
  // resting heart rate of zero and perfect calm.
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-23").length, 0);
  assert.equal(metricsOn("stress", "2026-07-23").length, 0);
  assert.ok(evidence.healthMetrics.every((metric) => metric.value > 0));

  // Steps and Body Battery were still measured that day and must survive.
  assert.equal(metricsOn("steps", "2026-07-23")[0].value, 7420);
  assert.equal(assessmentsOn("body_battery", "2026-07-23")[0].value, 61);
});

test("a readiness score Garmin declined to compute is not laundered into evidence", () => {
  assert.equal(assessmentsOn("vendor_readiness", "2026-07-23").length, 0, "level NONE must not be scored");
  // What Garmin can still supply that day is read instead of giving up.
  assert.equal(assessmentsOn("recovery_time_minutes", "2026-07-23")[0].value, 1180);
  assert.equal(assessmentsOn("vendor_readiness", "2026-07-22")[0].value, 74);
});

test("Garmin's own training load is preferred, and an estimate says it is one", () => {
  const run = evidence.workouts.find((workout) => workout.name === "Zone 2 Run");
  assert.equal(run.trainingLoad, 82);
  assert.equal(run.metadata.loadSource, "garmin_epoc");

  // The strength session carries no EPOC load, so the connector estimates from
  // duration — and labels it, so a caller can tell the two apart.
  const strength = evidence.workouts.find((workout) => workout.name === "Upper Body Strength");
  assert.equal(strength.type, "strength");
  assert.equal(strength.trainingLoad, 45);
  assert.equal(strength.metadata.loadSource, "duration_estimate");
});

test("a bare activityType string reads the same as Garmin's {typeKey} object", () => {
  const [modern] = buildGarminEvidence(
    { activities: [{ activityId: 1, beginTimestamp: Date.parse("2026-07-26T07:00:00Z"), duration: 1800000, activityType: { typeKey: "cycling" } }] },
    { asOf: ASOF }
  ).workouts;
  const [legacy] = buildGarminEvidence(
    { activities: [{ activityId: 1, beginTimestamp: Date.parse("2026-07-26T07:00:00Z"), duration: 1800000, activityType: "cycling" }] },
    { asOf: ASOF }
  ).workouts;

  assert.equal(modern.type, "ride");
  assert.deepEqual(legacy, modern);
});

test("the window filter is applied to every evidence stream", () => {
  // `asOf` anchors at midnight UTC, so sinceDays: 2 admits 07-24 onward.
  const narrow = buildGarminEvidence(rawExport, { asOf: ASOF, sinceDays: 2 });
  const days = new Set(
    [
      ...narrow.healthMetrics.map((metric) => metric.recordedAt),
      ...narrow.vendorAssessments.map((item) => item.recordedAt),
      ...narrow.workouts.map((workout) => workout.startedAt)
    ].map((iso) => iso.slice(0, 10))
  );

  assert.deepEqual([...days].sort(), ["2026-07-24", "2026-07-25", "2026-07-26"]);
});
