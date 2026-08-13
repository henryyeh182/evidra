// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { GoogleHealthApiLocalConnector } from "../../src/local/googleHealthApiLocal.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../../../data/fixtures/google-health-api/raw", import.meta.url));

test("GoogleHealthApiLocalConnector reads raw API responses and normalizes them", async () => {
  const connector = new GoogleHealthApiLocalConnector({ rawDir: FIXTURE_DIR });
  const events = await connector.pullNormalizedEvents();

  assert.ok(events.some((e) => e.kind === "workout" && e.type === "run"));
  assert.ok(events.some((e) => e.type === "resting_hr_bpm"));
  assert.ok(events.some((e) => e.type === "sleep_duration_hours"));
  // hrv_ms has no raw file in this fixture (mirrors the real account
  // measurement in this module's header comment: this write chain has none) —
  // absent stays absent, never guessed.
  assert.equal(events.some((e) => e.type === "hrv_ms"), false);
});

test("GoogleHealthApiLocalConnector returns no events when the raw folder does not exist", async () => {
  const connector = new GoogleHealthApiLocalConnector({ rawDir: fileURLToPath(new URL("../../../../data/fixtures/does-not-exist", import.meta.url)) });
  assert.deepEqual(await connector.pullNormalizedEvents(), []);
});
