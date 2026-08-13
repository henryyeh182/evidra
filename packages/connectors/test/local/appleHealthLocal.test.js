// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { AppleHealthLocalConnector } from "../../src/local/appleHealthLocal.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../../../data/fixtures/apple-health", import.meta.url));

test("AppleHealthLocalConnector reads the newest export.xml in the folder and normalizes it", async () => {
  const connector = new AppleHealthLocalConnector({ baseDir: FIXTURE_DIR });
  const events = await connector.pullNormalizedEvents();

  assert.ok(events.length > 0);
  assert.ok(events.some((e) => e.kind === "workout"));
  assert.ok(events.some((e) => e.kind === "health_metric" && e.type === "hrv_ms"));
});

test("AppleHealthLocalConnector returns no events when the folder does not exist", async () => {
  const connector = new AppleHealthLocalConnector({ baseDir: fileURLToPath(new URL("../../../../data/fixtures/does-not-exist", import.meta.url)) });
  assert.deepEqual(await connector.pullNormalizedEvents(), []);
});
