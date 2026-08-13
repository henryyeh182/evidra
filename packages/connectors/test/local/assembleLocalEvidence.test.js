// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { readFile } from "node:fs/promises";

import { assembleLocalEvidence } from "../../src/local/assembleLocalEvidence.js";
import { generateSemanticFitnessState } from "../../../semantic-engine/src/index.js";

const fixture = (relative) => fileURLToPath(new URL(`../../../../data/fixtures/${relative}`, import.meta.url));

const sampleContext = JSON.parse(
  await readFile(new URL("../../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);
const baseUserContext = { ...sampleContext, workouts: [], healthMetrics: [], vendorAssessments: [] };

test("assembleLocalEvidence merges all four sources into one context", async () => {
  const { context, sources } = await assembleLocalEvidence({
    appleHealthDir: fixture("apple-health"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export"),
    googleHealthRawDir: fixture("google-health-api/raw")
  });

  assert.equal(sources.appleHealth.status, "present");
  assert.equal(sources.garmin.status, "present");
  assert.equal(sources.strava.status, "present");
  assert.equal(sources.googleHealth.status, "present");

  // vendor_assessment events (Garmin's body_battery, recovery_time_minutes)
  // must land in the merged context, not be silently dropped.
  assert.ok(context.vendorAssessments.length > 0);
  assert.ok(context.workouts.length > 0);
  assert.ok(context.healthMetrics.length > 0);

  // The merge is order-independent per event id: running it a second time on
  // top of its own output must not duplicate anything.
  const { context: mergedTwice } = await assembleLocalEvidence({
    context,
    appleHealthDir: fixture("apple-health"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export"),
    googleHealthRawDir: fixture("google-health-api/raw")
  });
  assert.equal(mergedTwice.workouts.length, context.workouts.length);
  assert.equal(mergedTwice.healthMetrics.length, context.healthMetrics.length);
  assert.equal(mergedTwice.vendorAssessments.length, context.vendorAssessments.length);
});

test("a missing source is reflected as absent, not fabricated, and the other three still decide", async () => {
  const { context, sources } = await assembleLocalEvidence({
    context: baseUserContext,
    appleHealthDir: fixture("does-not-exist"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export"),
    googleHealthRawDir: fixture("google-health-api/raw")
  });

  assert.equal(sources.appleHealth.status, "absent");
  assert.equal(sources.appleHealth.eventCount, 0);
  assert.equal(sources.garmin.status, "present");

  const state = generateSemanticFitnessState(context, { date: "2026-07-22", timezone: baseUserContext.user.timezone });
  assert.ok(state.confidence !== undefined);
  assert.ok(state.signalCoverage);
});

test("only a single source present is still enough to produce a decision", async () => {
  const { context, sources } = await assembleLocalEvidence({
    context: baseUserContext,
    appleHealthDir: fixture("does-not-exist"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("does-not-exist"),
    googleHealthRawDir: fixture("does-not-exist")
  });

  assert.equal(sources.garmin.status, "present");
  assert.equal(sources.appleHealth.status, "absent");
  assert.equal(sources.strava.status, "absent");
  assert.equal(sources.googleHealth.status, "absent");

  const state = generateSemanticFitnessState(context, { date: "2026-07-22", timezone: baseUserContext.user.timezone });
  assert.ok(state.readinessScore !== undefined || state.signalCoverage.recovery.missing.length > 0);
});
