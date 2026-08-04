// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { computeTimeInZone, assertValidHeartRateZones } from "../src/timeInZone.js";

/** The boundaries Strava applied to the session this module was checked against. */
const ZONES = [
  { id: "Z1", name: "Recovery", bpmMax: 111 },
  { id: "Z2", name: "Endurance", bpmMin: 112, bpmMax: 139 },
  { id: "Z3", name: "Tempo", bpmMin: 140, bpmMax: 152 },
  { id: "Z4", name: "Threshold", bpmMin: 153, bpmMax: 166 },
  { id: "Z5", name: "Anaerobic", bpmMin: 167 }
];

const samples = (pairs) => pairs.map(([timestamp, bpm]) => ({ timestamp, bpm }));

test("a sample holds until the next one, and the last one holds nothing", () => {
  // Three samples, two intervals: 10s at 145 (Z3) and 5s at 120 (Z2). The final
  // sample has no successor, so it cannot claim any time.
  const result = computeTimeInZone(samples([[0, 145], [10, 120], [15, 100]]), ZONES);

  assert.equal(result.zones.find((z) => z.id === "Z3").seconds, 10);
  assert.equal(result.zones.find((z) => z.id === "Z2").seconds, 5);
  assert.equal(result.zones.find((z) => z.id === "Z1").seconds, 0);
  assert.equal(result.classifiedSeconds, 15);
});

test("boundaries are inclusive on both ends, so no second falls between two zones", () => {
  const result = computeTimeInZone(samples([[0, 111], [1, 112], [2, 139], [3, 140], [4, 152], [5, 153], [6, 100]]), ZONES);

  const seconds = Object.fromEntries(result.zones.map((z) => [z.id, z.seconds]));
  assert.equal(seconds.Z1, 1); // 111
  assert.equal(seconds.Z2, 2); // 112, 139
  assert.equal(seconds.Z3, 2); // 140, 152
  assert.equal(seconds.Z4, 1); // 153
  assert.equal(result.classifiedSeconds, 6);
  assert.equal(result.unclassifiedSeconds, 0);
});

test("a sample with no heart rate is not a low heart rate", () => {
  const result = computeTimeInZone(samples([[0, null], [30, 145], [40, 145]]), ZONES);

  assert.equal(result.unmeasuredSeconds, 30);
  assert.equal(result.zones.find((z) => z.id === "Z1").seconds, 0, "an absent reading must not become recovery time");
  assert.equal(result.classifiedSeconds, 10);
});

test("a long gap is a pause, not ten minutes of holding one heart rate", () => {
  const result = computeTimeInZone(samples([[0, 145], [600, 145], [601, 145]]), ZONES, {
    maxSampleGapSeconds: 30
  });

  assert.equal(result.zones.find((z) => z.id === "Z3").seconds, 31, "30s credited, then one real second");
  assert.equal(result.gapSeconds, 570, "the rest is named as a gap rather than counted");
});

test("percent is of measured time, so a strap that came off cannot make a session look easy", () => {
  const result = computeTimeInZone(samples([[0, 145], [100, null], [200, 145], [300, 145]]), ZONES, {
    maxSampleGapSeconds: 1000
  });

  // 200s of Z3, 100s unmeasured. Z3 is 100% of what was measured, not 66%.
  assert.equal(result.zones.find((z) => z.id === "Z3").percent, 100);
  assert.equal(result.unmeasuredSeconds, 100);
});

test("a reading no zone covers is reported, not rounded into the nearest one", () => {
  const gapped = [
    { id: "low", bpmMax: 100 },
    { id: "high", bpmMin: 150 }
  ];
  const result = computeTimeInZone(samples([[0, 125], [10, 160], [20, 160]]), gapped);

  assert.equal(result.unclassifiedSeconds, 10);
  assert.equal(result.zones.find((z) => z.id === "high").seconds, 10);
});

test("overlapping zones are refused, because the total would still look right", () => {
  assert.throws(
    () =>
      assertValidHeartRateZones([
        { id: "A", bpmMax: 140 },
        { id: "B", bpmMin: 130 }
      ]),
    /overlap/
  );
});

test("a zone table that cannot discriminate is refused", () => {
  assert.throws(() => assertValidHeartRateZones([]), /non-empty/);
  assert.throws(() => assertValidHeartRateZones([{ id: "everything" }]), /unbounded on both sides/);
  assert.throws(() => assertValidHeartRateZones([{ id: "A", bpmMin: 150, bpmMax: 120 }]), /above bpmMax/);
  assert.throws(
    () => assertValidHeartRateZones([{ id: "A", bpmMax: 100 }, { id: "A", bpmMin: 150 }]),
    /unique/
  );
});

test("the same samples give the same answer every run", () => {
  const input = samples([[0, 145], [10, 120], [20, 100], [30, 168], [40, 155]]);
  assert.deepEqual(computeTimeInZone(input, ZONES), computeTimeInZone(input, ZONES));
});
