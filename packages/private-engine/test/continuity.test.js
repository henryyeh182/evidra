// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import { buildDecisionContinuity } from "../src/continuity.js";

test("continuity accepts a full ISO as-of value and uses the athlete's local day boundary", () => {
  const context = {
    workouts: [
      { startedAt: "2026-07-22T15:59:59Z" },
      { startedAt: "2026-07-23T00:30:00Z" }
    ],
    healthMetrics: [],
    vendorAssessments: []
  };

  const continuity = buildDecisionContinuity({
    userId: "u1",
    date: "2026-07-22T12:00:00Z",
    timezone: "Asia/Taipei",
    state: {},
    context
  });

  assert.equal(continuity.evidenceWindow.earliest, "2026-07-22T15:59:59Z");
  assert.equal(continuity.evidenceWindow.latest, "2026-07-22T15:59:59Z");
});
