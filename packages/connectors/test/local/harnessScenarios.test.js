// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Evidence Flow Story 5: coverage for the four states a local export folder
// can actually be in. "Complete" and "a source is entirely missing" are
// already exercised by packages/connectors/test/local/assembleLocalEvidence.test.js;
// this file covers the other two — stale dates and malformed/dirty files —
// plus a Garmin-specific corrupt-file test, since the DI_CONNECT reader
// (packages/connectors/src/local/garminLocal.js) is new code, not an
// already-tested parser.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { assembleLocalEvidence } from "../../src/local/assembleLocalEvidence.js";
import { GarminLocalConnector } from "../../src/local/garminLocal.js";
import { generateSemanticFitnessState } from "../../../semantic-engine/src/index.js";

const fixture = (relative) => fileURLToPath(new URL(`../../../../data/fixtures/${relative}`, import.meta.url));

const sampleContext = JSON.parse(
  await readFile(new URL("../../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

test("complete: every configured source produces events and signalCoverage is fully usable at the export's own dates", async () => {
  const { context, sources } = await assembleLocalEvidence({
    context: sampleContext,
    appleHealthDir: fixture("apple-health"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export"),
    googleHealthRawDir: fixture("google-health-api/raw")
  });
  for (const info of Object.values(sources)) assert.equal(info.status, "present");

  const state = generateSemanticFitnessState(context, { date: "2026-07-22", timezone: sampleContext.user.timezone });
  assert.equal(state.signalCoverage.recovery.missing.length, 0);
});

test("stale: readings older than each signal's staleness window drop out of usable and into missing, not fabricated as current", async () => {
  const { context } = await assembleLocalEvidence({
    context: sampleContext,
    appleHealthDir: fixture("does-not-exist"),
    garminDir: fixture("garmin/di-connect-export"), // dated 2026-07-21/22 only
    stravaDir: fixture("does-not-exist"),
    googleHealthRawDir: fixture("does-not-exist")
  });

  // Three weeks past every staleness window declared in
  // packages/rules/data/engine-parameters.json (sleep 3d, autonomic 7d,
  // resting HR 14d, vendor composite 2d) — every recovery signal in this
  // fixture should read as missing, not as still-current.
  const state = generateSemanticFitnessState(context, { date: "2026-08-12", timezone: sampleContext.user.timezone });
  const { usable, missing } = state.signalCoverage.recovery;
  assert.equal(usable.length, 0, `expected nothing usable once stale, got: ${usable.join(", ")}`);
  assert.ok(missing.includes("hrv") || missing.includes("hrv_ms") || missing.length > 0);
});

test("dirty: a corrupt JSON file and malformed records do not stop the other, well-formed files in the same folder from being read", async () => {
  const connector = new GarminLocalConnector({ baseDir: fixture("garmin/di-connect-export-dirty") });
  const events = await connector.pullNormalizedEvents();

  // The broken TrainingReadinessDTO file must not prevent the sibling valid
  // one from being read.
  assert.ok(events.some((e) => e.type === "recovery_time_minutes"));
  // The UDSFile record with no calendarDate is skipped, but the sibling
  // record with one still produces a reading.
  assert.ok(events.some((e) => e.type === "steps" && e.value === 8000));
  // The healthStatusData record with `metrics: null` does not throw, and its
  // well-formed sibling still produces hrv_ms.
  assert.ok(events.some((e) => e.type === "hrv_ms"));
  // The activity missing beginTimestamp is dropped; the sibling with one survives.
  const workouts = events.filter((e) => e.kind === "workout");
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].type, "ride");
});

test("dirty: a Strava activities.csv with a changed column layout is reported as a source error, not a crash that takes down the other three sources", async () => {
  const { context, sources } = await assembleLocalEvidence({
    context: sampleContext,
    appleHealthDir: fixture("apple-health"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export-dirty"), // activities.csv with an unexpected column layout
    googleHealthRawDir: fixture("google-health-api/raw")
  });
  assert.equal(sources.strava.status, "error");
  assert.equal(sources.strava.eventCount, 0);
  assert.match(sources.strava.error, /column .* should be/);
  // The other three sources still made it into the merged context.
  assert.equal(sources.appleHealth.status, "present");
  assert.equal(sources.garmin.status, "present");
  assert.equal(sources.googleHealth.status, "present");
  assert.ok(context.workouts.length > 0);
});
