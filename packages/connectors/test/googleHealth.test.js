import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { parseGoogleHealthExport, buildGoogleHealthEvidence } from "../src/providers/google-health/index.js";
import { VENDOR_SCHEMAS, CANONICAL_SIGNALS } from "../../evidence/src/index.js";
import { validate } from "../../../eval/lib/jsonSchema.js";

// The fixture is a sanitized miniature of a real 480-file Takeout export: same
// headers, same sentinels (0 bpm, 0.0 in the monthly JSON, CALCULATION_FAILED),
// same dual-recorder step rows, fake values. Loaded as path → text, exactly as
// a caller would hand the archive over.
const fixtureDir = new URL("../../../data/fixtures/google-health/", import.meta.url);
const files = Object.fromEntries(
  await Promise.all(
    (await readdir(fixtureDir)).map(async (name) => [name, await readFile(new URL(name, fixtureDir), "utf8")])
  )
);

const sourceSchema = JSON.parse(
  await readFile(new URL("../../../schemas/sources/google-health.export.json", import.meta.url), "utf8")
);
const evidenceSchema = JSON.parse(
  await readFile(new URL("../../../schemas/evidence/fitness-evidence.json", import.meta.url), "utf8")
);

const ASOF = "2026-07-26";
const parts = parseGoogleHealthExport(files);
const evidence = buildGoogleHealthEvidence(parts, { asOf: ASOF, sinceDays: 30 });

const metricsOn = (type, day) =>
  evidence.healthMetrics.filter((metric) => metric.type === type && metric.recordedAt.startsWith(day));

test("the parsed fixture is legal by our own source schema", () => {
  const result = validate(parts, sourceSchema);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("normalized Google Health evidence satisfies the Fitness Evidence Model", () => {
  const result = validate(evidence, evidenceSchema);
  assert.equal(result.valid, true, result.errors.join("\n"));
});

test("every signal the registry declares for the Takeout dialect is actually parsed", () => {
  const declared = [...new Set(VENDOR_SCHEMAS.google_health_export.signals.map((mapping) => mapping.to))];
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

test("emitted signals carry canonical names, units and the platform source label", () => {
  for (const metric of [...evidence.healthMetrics, ...evidence.vendorAssessments]) {
    const spec = CANONICAL_SIGNALS[metric.type];
    assert.ok(spec, `${metric.type} is not part of the canonical vocabulary`);
    assert.equal(metric.unit, spec.unit, `${metric.type} unit`);
    assert.equal(metric.source, "google_health_connect");
  }
});

test("midnight-in-UTC stamps land on the local day, not the UTC date", () => {
  // 2026-07-19T16:00:00Z is 00:00 +08:00 on the 20th. Reading the UTC date
  // would misfile every row of the observed export.
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-19").length, 0);
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-20")[0]?.value, 59);
});

test("the CSV and monthly-JSON spellings of resting HR merge without double-emitting", () => {
  // 2026-07-20 exists in both spellings (59 via the CSV's midnight stamp, 62
  // in the JSON): the
  // CSV wins and exactly one event exists. 2026-07-24 exists only in the JSON.
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-20").length, 1);
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-24")[0]?.value, 57);
});

test("0 and 0.0 never become a heart rate", () => {
  // The CSV's 0.0 row (local 2026-07-22) and the JSON's 0.0 day (2026-07-25).
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-22").length, 0);
  assert.equal(metricsOn("resting_hr_bpm", "2026-07-25").length, 0);
  assert.ok(evidence.healthMetrics.every((metric) => metric.value > 0));
});

test("dual-recorder steps take the best single recorder, never the double-counted sum", () => {
  // 2026-07-20 arrives from Garmin (8000) and the phone (5000) at once.
  const [day] = metricsOn("steps", "2026-07-20");
  assert.equal(day?.value, 8000);
  assert.equal(day?.metadata?.aggregation, "daily_max_across_sources");
});

test("sleep minutes become hours on the local wake-up day", () => {
  // 337 minutes ending 21:56Z +08:00 = 05:56 on the 20th, local.
  const [night] = metricsOn("sleep_duration_hours", "2026-07-20");
  assert.equal(night?.value, 5.62);
});

test("a failed stress calculation is not a calm day", () => {
  assert.equal(metricsOn("stress", "2026-07-24").length, 0);
  assert.equal(metricsOn("stress", "2026-07-25")[0]?.value, 78);
});

test("workout load prefers Fitbit's own Cardio Load, then measured energy, then honesty", () => {
  const byName = Object.fromEntries(evidence.workouts.map((workout) => [workout.metadata.googleHealthActivityName, workout]));

  assert.equal(byName.Bike.trainingLoad, 47);
  assert.equal(byName.Bike.metadata.loadSource, "fitbit_cardio_load");

  assert.equal(byName["Outdoor Run"].trainingLoad, 26); // 257 kcal / 10, the Apple Health convention
  assert.equal(byName["Outdoor Run"].metadata.loadSource, "active_energy");

  assert.equal(byName.Yoga.trainingLoad, null);
  assert.equal(byName.Yoga.metadata.loadSource, "unavailable");
});

test("0-bpm session heart rates are reported absent, not athletic", () => {
  const run = evidence.workouts.find((workout) => workout.metadata.googleHealthActivityName === "Outdoor Run");
  assert.equal(run.metadata.avgHr, null);
  assert.equal(run.metadata.maxHr, null);
  assert.equal(run.rpe, null); // the dialect has no RPE; absent stays absent
});
