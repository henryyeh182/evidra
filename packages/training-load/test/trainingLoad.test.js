import test from "node:test";
import assert from "node:assert/strict";

import { computeTrainingLoad, computePersonalBaselines } from "../src/index.js";

const day = (n) => {
  const date = new Date("2026-05-01T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString();
};

/** Eight weeks: steady base, a build, a spike week, then a taper. */
function trainingBlock() {
  const workouts = [];
  for (let i = 0; i < 28; i += 2) workouts.push({ startedAt: day(i), trainingLoad: 60 });
  for (let i = 28; i < 42; i += 2) workouts.push({ startedAt: day(i), trainingLoad: 90 });
  for (let i = 42; i < 49; i += 1) workouts.push({ startedAt: day(i), trainingLoad: 130 });
  for (let i = 49; i < 56; i += 3) workouts.push({ startedAt: day(i), trainingLoad: 40 });
  return workouts;
}

test("a load spike shows up as overreaching", () => {
  const result = computeTrainingLoad(trainingBlock(), { asOf: "2026-06-19" });

  assert.equal(result.zone, "overreaching");
  assert.ok(result.tsb < -30, `expected deeply negative TSB, got ${result.tsb}`);
  assert.ok(result.atl > result.ctl, "acute load must exceed chronic during a spike");
});

test("a taper brings the athlete back toward balance", () => {
  const spike = computeTrainingLoad(trainingBlock(), { asOf: "2026-06-19" });
  const tapered = computeTrainingLoad(trainingBlock(), { asOf: "2026-06-25" });

  assert.ok(tapered.tsb > spike.tsb, "TSB should recover during a taper");
  assert.ok(tapered.acwr < spike.acwr);
});

test("rest days decay the curves rather than freezing them", () => {
  // Two weeks after the last session: fatigue drains, fitness bleeds slowly.
  const result = computeTrainingLoad(trainingBlock(), { asOf: "2026-07-10" });

  assert.ok(result.atl < 10, `acute load should have drained, got ${result.atl}`);
  assert.ok(result.ctl > result.atl, "chronic fitness decays far slower than fatigue");
  assert.ok(result.tsb > 20, "a long layoff reads as very fresh");
});

test("a steady athlete sits near equilibrium instead of looking overreached", () => {
  // Cold-start regression: seeding both curves at zero made CTL climb for six
  // weeks while ATL settled in one, so steady training read as a huge spike.
  const steady = [];
  for (let i = 0; i < 28; i += 2) steady.push({ startedAt: day(i), trainingLoad: 60 });

  const result = computeTrainingLoad(steady, { asOf: "2026-05-25" });

  assert.ok(result.acwr < 1.4, `steady training should not look like a spike, got ACWR ${result.acwr}`);
  assert.ok(Math.abs(result.tsb) < 15, `expected TSB near balance, got ${result.tsb}`);
});

test("too little history is reported as such, not dressed up as a verdict", () => {
  const sparse = [
    { startedAt: day(0), trainingLoad: 60 },
    { startedAt: day(2), trainingLoad: 60 },
    { startedAt: day(4), trainingLoad: 60 }
  ];

  const result = computeTrainingLoad(sparse, { asOf: "2026-05-05" });

  assert.equal(result.zone, "insufficient_history");
  assert.equal(result.coverage.sufficient, false);
  assert.match(result.zoneNote, /尚未收斂/);
});

test("no workouts at all yields zeroes rather than NaN", () => {
  const result = computeTrainingLoad([], { asOf: "2026-05-05" });

  assert.equal(result.ctl, 0);
  assert.equal(result.atl, 0);
  assert.equal(result.acwr, 0);
});

test("personal baselines replace population averages", () => {
  // An athlete whose HRV genuinely runs near 38, not the 52 population default.
  const metrics = [];
  for (let i = 0; i < 30; i += 1) metrics.push({ type: "hrv_ms", value: 36 + (i % 5), recordedAt: day(i + 20) });

  const { baselines } = computePersonalBaselines(metrics, { asOf: "2026-06-25" });

  assert.equal(baselines.hrv_ms.median, 38);
  assert.equal(baselines.hrv_ms.reliable, true);
});

test("a baseline from a handful of readings is flagged unreliable", () => {
  const metrics = [
    { type: "hrv_ms", value: 40, recordedAt: day(50) },
    { type: "hrv_ms", value: 44, recordedAt: day(51) }
  ];

  const { baselines } = computePersonalBaselines(metrics, { asOf: "2026-06-25" });

  assert.equal(baselines.hrv_ms.sampleCount, 2);
  assert.equal(baselines.hrv_ms.reliable, false);
});

test("the median ignores a single outlier night", () => {
  const metrics = [];
  for (let i = 0; i < 20; i += 1) metrics.push({ type: "hrv_ms", value: 40, recordedAt: day(i + 30) });
  metrics.push({ type: "hrv_ms", value: 5, recordedAt: day(51) }); // one terrible night

  const { baselines } = computePersonalBaselines(metrics, { asOf: "2026-06-25" });

  assert.equal(baselines.hrv_ms.median, 40, "one bad night must not move the baseline");
});

test("the returned series lets a caller remember and audit the curve", () => {
  const result = computeTrainingLoad(trainingBlock(), { asOf: "2026-06-19" });

  assert.ok(Array.isArray(result.series) && result.series.length > 0);
  const last = result.series[result.series.length - 1];
  assert.equal(last.date, "2026-06-19");
  for (const key of ["date", "load", "ctl", "atl", "tsb"]) {
    assert.ok(key in last, `series points carry ${key} so the curve is auditable later`);
  }
});

test("sessions after the as-of date never leak into the curve", () => {
  // Regression: the seed summed every supplied workout, so a single early
  // as-of date inherited months of future load and read as absurdly fatigued.
  const workouts = [
    { startedAt: day(0), trainingLoad: 50 },
    { startedAt: day(60), trainingLoad: 5000 } // far future, must be ignored
  ];

  const result = computeTrainingLoad(workouts, { asOf: "2026-05-02" });

  assert.ok(result.atl < 100, `future load leaked into ATL: ${result.atl}`);
  assert.ok(result.ctl < 100, `future load leaked into CTL: ${result.ctl}`);
});
