// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { assembleLocalEvidence } from "../../../packages/connectors/src/local/assembleLocalEvidence.js";
import { applyNormalizedEventsToContext } from "../../../packages/connectors/src/normalization.js";
import { SQLiteFitnessRepository } from "../../../packages/db/src/index.js";
import { LocalPrivateEngine } from "../../../packages/private-engine/src/index.js";

const fixture = (relative) => fileURLToPath(new URL(`../../../data/fixtures/${relative}`, import.meta.url));

const sampleContext = JSON.parse(
  await readFile(new URL("../../../data/seeds/sample-user-context.json", import.meta.url), "utf8")
);

const DIRS = {
  baseDir: fixture("does-not-exist"), // no unused default folders leak in
  appleHealthDir: fixture("apple-health"),
  garminDir: fixture("garmin/di-connect-export"),
  stravaDir: fixture("strava/export"),
  googleHealthRawDir: fixture("google-health-api/raw")
};

/** Mirrors what scripts/import-local-evidence.js does: assemble, merge onto
 * whatever the repository already has, save (repository can only hold
 * workouts/health metrics), then decide from the in-memory merge (which
 * still carries vendor_assessment). */
async function importOnce(repository) {
  const { events } = await assembleLocalEvidence(DIRS);
  const existing = await repository.getUserContext(sampleContext.user.id);
  const merged = applyNormalizedEventsToContext(existing || sampleContext, events);
  await repository.saveUserContext(merged);

  const engine = new LocalPrivateEngine({ repository });
  return engine.decideToday({ userId: sampleContext.user.id, date: "2026-07-22", context: merged });
}

test("importing the same local export files twice produces the same decision and does not duplicate evidence (Evidence Flow Story 3)", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const first = await importOnce(repository);
    const second = await importOnce(repository);

    assert.equal(first.provenance.evidenceSource, "local-file-import");
    assert.equal(first.provenance.hostedMcp, false);
    assert.equal(first.decision.type, second.decision.type);
    assert.equal(first.decision.intent, second.decision.intent);
    assert.equal(first.confidence, second.confidence);
    assert.deepEqual(first.reason, second.reason);
    assert.deepEqual(first.signalCoverage, second.signalCoverage);
    assert.deepEqual(first.action, second.action);

    // Re-importing the same files must dedupe by stable id, not double the count.
    const afterSecondImport = await repository.getUserContext(sampleContext.user.id);
    const afterFirstImport = applyNormalizedEventsToContext(
      sampleContext,
      (await assembleLocalEvidence(DIRS)).events
    );
    assert.equal(afterSecondImport.workouts.length, afterFirstImport.workouts.length);
    assert.equal(afterSecondImport.healthMetrics.length, afterFirstImport.healthMetrics.length);
  } finally {
    repository.close();
  }
});

test("vendor_assessment evidence (Garmin recoveryTime, Body Battery) reaches the decision even though the repository cannot persist it", async () => {
  const repository = new SQLiteFitnessRepository();
  try {
    const { events } = await assembleLocalEvidence(DIRS);
    const merged = applyNormalizedEventsToContext(sampleContext, events);
    await repository.saveUserContext(merged);

    // A read straight back from the repository must NOT carry
    // vendor_assessment — that gap is exactly why decideToday takes a
    // context override instead of always re-reading.
    const reread = await repository.getUserContext(sampleContext.user.id);
    assert.equal(reread.vendorAssessments, undefined);
    assert.ok(merged.vendorAssessments.some((a) => a.type === "body_battery"));

    const engine = new LocalPrivateEngine({ repository });
    const decision = await engine.decideToday({ userId: sampleContext.user.id, date: "2026-07-22", context: merged });
    assert.equal(decision.provenance.evidenceSource, "local-file-import");
  } finally {
    repository.close();
  }
});
