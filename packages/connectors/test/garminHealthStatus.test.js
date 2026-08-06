// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Garmin's daily Health Status file — the only place a usable HRV figure comes
 * from.
 *
 * `TrainingReadinessDTO.hrvWeeklyAverage` is a weekly average that sits at the
 * not-established sentinel 511 until Garmin has a sustained run of nights, and
 * is deliberately mapped to nothing. This file is daily and carries a real
 * reading as soon as one night is measured, which is why it exists as a second
 * parser rather than a fallback inside the first.
 *
 * The assertions here are the six this repo allows for a dialect: canonical
 * naming, unit, registry/parser agreement, sentinels not leaking, gaps reported
 * honestly, and the decision still standing up and explaining itself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  normalizeGarminHealthStatus,
  buildGarminEvidence
} from "../src/providers/garmin/index.js";
import { VENDOR_SCHEMAS } from "../../evidence/src/schemaRegistry.js";

const sample = JSON.parse(
  await readFile(new URL("../../../data/fixtures/garmin/export-sample.json", import.meta.url), "utf8")
);

test("a real HRV reading is normalized to hrv_ms in milliseconds", () => {
  const events = normalizeGarminHealthStatus(sample.healthStatus);
  const day = events.find((event) => event.recordedAt.startsWith("2026-07-22"));

  assert.equal(day.type, "hrv_ms");
  assert.equal(day.value, 43);
  assert.equal(day.unit, "ms");
  assert.equal(day.source, "garmin");
});

// 0 is the off-wrist sentinel, the same class of value as restingHeartRate 0 and
// averageStressLevel -1 elsewhere in this export. Letting it through would read
// as an HRV of zero, which recovery scoring would treat as the worst possible
// night rather than as no night at all.
test("the 0 sentinel does not leak out as a measurement", () => {
  const events = normalizeGarminHealthStatus(sample.healthStatus);

  assert.equal(
    events.some((event) => event.recordedAt.startsWith("2026-07-23")),
    false,
    "the off-wrist night must produce no hrv_ms event"
  );
  assert.equal(events.some((event) => event.value === 0), false);
});

test("a day whose file carries no HRV metric produces no event", () => {
  const events = normalizeGarminHealthStatus(sample.healthStatus);

  assert.equal(events.some((event) => event.recordedAt.startsWith("2026-07-26")), false);
});

// ONBOARDING describes Garmin's confidence in its own baseline, not an absent
// measurement. Gating admission on it would discard real readings for days or
// weeks — which is the whole reason this file is preferred over the weekly
// average.
test("an ONBOARDING reading is admitted at full value and flagged, not discarded", () => {
  const events = normalizeGarminHealthStatus(sample.healthStatus);
  const onboarding = events.find((event) => event.recordedAt.startsWith("2026-07-24"));
  const settled = events.find((event) => event.recordedAt.startsWith("2026-07-25"));

  assert.equal(onboarding.value, 50, "the value is used as measured");
  assert.equal(onboarding.metadata.onboarding, true);
  assert.equal(settled.value, 37);
  assert.equal(settled.metadata.onboarding, false, "a record with no status is not onboarding");
});

// Every normalized event needs an id. Events without one were overwriting each
// other downstream, which silently reduced nineteen health metrics to one.
test("every event carries a stable id, and ids are unique per day", () => {
  const events = normalizeGarminHealthStatus(sample.healthStatus);

  assert.ok(events.length > 1);
  for (const event of events) assert.ok(event.id, "an event without an id will be deduplicated away");
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
});

test("ids are stable across runs, so re-importing the same export does not duplicate", () => {
  const first = normalizeGarminHealthStatus(sample.healthStatus).map((event) => event.id);
  const second = normalizeGarminHealthStatus(sample.healthStatus).map((event) => event.id);

  assert.deepEqual(first, second);
});

// The registry is what a caller reads to know what a source can supply. A parser
// producing a signal the registry never declares is the drift this assertion
// exists to catch.
test("the registry declares the hrv_ms mapping this parser produces", () => {
  const declared = VENDOR_SCHEMAS.garmin.signals.find((signal) => signal.to === "hrv_ms");

  assert.ok(declared, "garmin must declare hrv_ms now that a parser emits it");
  assert.equal(declared.scale, "ms");
  assert.match(declared.from, /HRV/, "the mapping must name the Health Status metric, not hrvWeeklyAverage");
});

test("hrvWeeklyAverage stays unmapped, so the 511 sentinel cannot reach hrv_ms", () => {
  const declared = VENDOR_SCHEMAS.garmin.signals.filter((signal) => signal.to === "hrv_ms");

  assert.equal(declared.length, 1, "exactly one path to hrv_ms");
  assert.equal(
    declared.some((signal) => signal.from.includes("hrvWeeklyAverage")),
    false,
    "the weekly average reads 511 on every day of a real 330-day export"
  );
});

test("health status folds into the assembled evidence alongside the other files", () => {
  const evidence = buildGarminEvidence(sample, { asOf: "2026-07-26T12:00:00Z" });
  const hrv = evidence.healthMetrics.filter((metric) => metric.type === "hrv_ms");

  assert.equal(hrv.length, 3, "three of five days carry a usable reading");
  assert.equal(
    evidence.healthMetrics.some((metric) => metric.type === "hrv_ms" && metric.value === 511),
    false,
    "the weekly-average sentinel must not appear"
  );
});
