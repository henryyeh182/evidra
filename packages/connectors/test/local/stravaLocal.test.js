// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { StravaLocalConnector } from "../../src/local/stravaLocal.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../../../data/fixtures/strava/export", import.meta.url));

test("StravaLocalConnector reads a bulk export directory and normalizes it", async () => {
  const connector = new StravaLocalConnector({ baseDir: FIXTURE_DIR });
  const events = await connector.pullNormalizedEvents();

  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.kind === "workout"));
  assert.ok(events.every((e) => e.source === "strava"));
});

test("StravaLocalConnector returns no events when activities.csv is missing", async () => {
  const connector = new StravaLocalConnector({ baseDir: fileURLToPath(new URL("../../../../data/fixtures/does-not-exist", import.meta.url)) });
  assert.deepEqual(await connector.pullNormalizedEvents(), []);
});
