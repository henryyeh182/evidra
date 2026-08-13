// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  callAcceptsLocalEvidence,
  hasUsableEvidence,
  contextToEvidence,
  loadLocalEvidence
} from "../src/localEvidence.js";
import { assertValidEvidence } from "../../../packages/evidence/src/model.js";

const fixture = (relative) => fileURLToPath(new URL(`../../../data/fixtures/${relative}`, import.meta.url));

test("callAcceptsLocalEvidence matches both canonical and public tool names", () => {
  assert.equal(callAcceptsLocalEvidence("decide_session"), true);
  assert.equal(callAcceptsLocalEvidence("evidra_decide_session"), true);
  assert.equal(callAcceptsLocalEvidence("assess_fitness_state"), true);
  assert.equal(callAcceptsLocalEvidence("generate_plan"), true);
  assert.equal(callAcceptsLocalEvidence("generate_workout"), true);
  // No evidence field on this tool's input schema — must not intercept it.
  assert.equal(callAcceptsLocalEvidence("decide_exercise_substitution"), false);
  assert.equal(callAcceptsLocalEvidence("evidra_local_decide_today"), false);
});

test("hasUsableEvidence treats missing, empty and populated evidence correctly", () => {
  assert.equal(hasUsableEvidence(undefined), false);
  assert.equal(hasUsableEvidence({}), false);
  assert.equal(hasUsableEvidence({ profile: { timezone: "UTC" } }), false);
  assert.equal(hasUsableEvidence({ workouts: [] }), false);
  assert.equal(hasUsableEvidence({ workouts: [{ startedAt: "2026-01-01", durationMinutes: 30 }] }), true);
  assert.equal(
    hasUsableEvidence({ healthMetrics: [{ type: "hrv_ms", value: 40, recordedAt: "2026-01-01" }] }),
    true
  );
});

test("contextToEvidence renames user->profile and keeps only the fields evidenceToUserContext reads", () => {
  const context = {
    user: { id: "u1", timezone: "Asia/Taipei", fitnessLevel: "advanced" },
    goals: [{ id: "g1", type: "endurance", label: "Half", priority: 1 }],
    injuries: [{ id: "i1", bodyRegion: "knee", severity: "mild", restrictions: [], status: "active" }],
    equipment: [{ type: "none", location: "outdoor", available: true }],
    workouts: [{ id: "w1", startedAt: "2026-08-01T00:00:00Z", durationMinutes: 40, type: "run" }],
    healthMetrics: [{ type: "hrv_ms", value: 45, recordedAt: "2026-08-01T00:00:00Z", source: "garmin" }],
    vendorAssessments: [{ type: "body_battery", value: 60, recordedAt: "2026-08-01T00:00:00Z", source: "garmin" }]
  };

  const evidence = contextToEvidence(context, { asOf: "2026-08-06" });
  assert.equal(evidence.profile.timezone, "Asia/Taipei");
  assert.equal(evidence.profile.fitnessLevel, "advanced");
  assert.equal(evidence.constraints.injuries.length, 1);
  assert.equal(evidence.constraints.equipment.length, 1);
  assert.equal(evidence.workouts.length, 1);
  assert.equal(evidence.healthMetrics.length, 1);
  assert.equal(evidence.vendorAssessments.length, 1);

  // Must pass the same validation a caller-supplied evidence payload does —
  // this is going to be handed to the exact same tool handler.
  assert.doesNotThrow(() => assertValidEvidence(evidence));
});

test("contextToEvidence drops evidence older than the sinceDays window", () => {
  const context = {
    user: { id: "u1", timezone: "UTC" },
    workouts: [{ startedAt: "2025-01-01T00:00:00Z", durationMinutes: 40 }],
    healthMetrics: [{ type: "hrv_ms", value: 45, recordedAt: "2025-01-01T00:00:00Z" }],
    vendorAssessments: []
  };
  const evidence = contextToEvidence(context, { sinceDays: 90, asOf: "2026-08-06" });
  assert.equal(evidence.workouts.length, 0);
  assert.equal(evidence.healthMetrics.length, 0);
});

test("loadLocalEvidence returns null when no local export folder exists", async () => {
  const { evidence, sources } = await loadLocalEvidence({ baseDir: fixture("does-not-exist") });
  assert.equal(evidence, null);
  assert.equal(Object.values(sources).every((s) => s.status !== "present"), true);
});

test("loadLocalEvidence assembles real fixture data into a valid evidence payload with a real timezone", async () => {
  // The fixtures live directly under data/fixtures/garmin/di-connect-export
  // etc. (not under a single joint baseDir), so point each connector
  // directly rather than relying on assembleLocalEvidence's folder-name
  // convention — mirrors packages/connectors/test/local/assembleLocalEvidence.test.js.
  const { assembleLocalEvidence } = await import("../../../packages/connectors/src/local/assembleLocalEvidence.js");
  const { context } = await assembleLocalEvidence({
    context: { user: { id: "local_user", timezone: "UTC" }, goals: [], injuries: [], equipment: [], workouts: [], healthMetrics: [], vendorAssessments: [] },
    appleHealthDir: fixture("apple-health"),
    garminDir: fixture("garmin/di-connect-export"),
    stravaDir: fixture("strava/export"),
    googleHealthRawDir: fixture("google-health-api/raw")
  });
  const evidence = contextToEvidence(context, { asOf: "2026-07-22" });
  assert.doesNotThrow(() => assertValidEvidence(evidence));
  assert.ok(evidence.workouts.length > 0);
  assert.ok(evidence.healthMetrics.length > 0);
  assert.ok(evidence.vendorAssessments.length > 0);
});
