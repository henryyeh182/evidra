// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { getSemanticFitnessState, decideSessionTool } from "../src/toolHandlers.js";
import { latestEvidenceDay } from "../src/demoData.js";
import { todayInTimezone } from "../../../packages/domain/src/dates.js";

function readPayload(response) {
  return JSON.parse(response.content[0].text);
}

// Evidence dated relative to the run, so this stays a test of the default date
// rather than of how long ago the fixture was written.
function evidenceEndingToday(timezone) {
  const today = todayInTimezone(timezone);
  return {
    profile: { timezone, fitnessLevel: "intermediate" },
    goals: [{ id: "g1", type: "general_fitness", priority: 1 }],
    constraints: { availableMinutes: 60, equipment: ["dumbbell"] },
    healthMetrics: [
      { type: "hrv_ms", value: 48, recordedAt: `${today}T06:00:00`, source: "garmin" },
      { type: "resting_hr_bpm", value: 52, recordedAt: `${today}T06:00:00`, source: "garmin" }
    ],
    workouts: [
      {
        type: "strength",
        startedAt: `${today}T07:00:00`,
        durationMinutes: 45,
        rpe: 6,
        muscleGroups: ["legs"],
        source: "garmin"
      }
    ]
  };
}

test("an omitted date resolves to today in the user's timezone, not a frozen literal", async () => {
  const timezone = "Asia/Taipei";
  const response = await getSemanticFitnessState({
    userId: "external_user",
    evidence: evidenceEndingToday(timezone)
  });

  assert.equal(readPayload(response).date, todayInTimezone(timezone));
});

test("the same call in a different timezone can land on a different day", async () => {
  // Not an assertion that the days differ on every run — for most of the UTC
  // day they agree. What must hold is that each answer is that zone's own day.
  for (const timezone of ["Asia/Taipei", "America/Los_Angeles", "UTC"]) {
    const response = await decideSessionTool({
      userId: "external_user",
      evidence: evidenceEndingToday(timezone)
    });

    assert.equal(readPayload(response).date, todayInTimezone(timezone));
  }
});

test("the demo seed anchors to its own latest day and says so", async () => {
  const response = await getSemanticFitnessState({ useDemoSeed: true });
  const payload = readPayload(response);

  assert.equal(payload.provenance.evidenceSource, "demo_seed");
  assert.equal(payload.date, payload.provenance.dateAnchoredTo);
  assert.match(payload.provenance.dateAnchorReason, /demo seed/);
});

test("the seed anchor is derived from the seed, so it moves when the seed does", () => {
  const context = {
    user: { timezone: "Asia/Taipei" },
    workouts: [{ startedAt: "2026-07-22T07:30:00+08:00" }],
    healthMetrics: [{ recordedAt: "2026-07-23T06:30:00+08:00" }]
  };

  assert.equal(latestEvidenceDay(context), "2026-07-23");
  assert.equal(latestEvidenceDay({ user: { timezone: "UTC" }, workouts: [], healthMetrics: [] }), null);
});
