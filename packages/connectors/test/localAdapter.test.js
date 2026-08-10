// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { FixtureConnectorAdapter, LocalConnectorAdapter } from "../src/index.js";

test("local connector interface has a deterministic normalized fixture path", async () => {
  const events = [{ kind: "health_metric", source: "manual", type: "hrv_ms", value: 52 }];
  const adapter = new FixtureConnectorAdapter({ provider: "manual", events });
  const pulled = await adapter.pullNormalizedEvents();
  assert.deepEqual(pulled, events);
  pulled[0].value = 0;
  assert.equal((await adapter.pullNormalizedEvents())[0].value, 52);
});

test("unimplemented local connector fails explicitly at the adapter boundary", async () => {
  await assert.rejects(
    new LocalConnectorAdapter({ provider: "garmin" }).pullNormalizedEvents(),
    /must implement pullNormalizedEvents/
  );
});
