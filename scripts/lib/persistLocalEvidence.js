// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Shared by the per-platform import scripts (Apple Health, Google Health API,
// ...). Each script normalizes its own source into events and calls this once.
//
// SQLiteFitnessRepository.saveUserContext replaces a user's entire
// workouts/health_metrics rows in one transaction — it has no notion of
// "add these on top of what's already there." Calling it directly from each
// import script, each starting from the same empty data/private/my-user-context.json
// profile, means the second script to run wipes out the first script's
// workouts and health metrics instead of accumulating with them. This helper
// closes that gap: it reads whatever is already saved for the user, merges
// the new events into that (not into the blank profile), and only then saves —
// so running Apple Health import after Google Health import adds to the
// stored context instead of replacing it.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { applyNormalizedEventsToContext } from "../../packages/connectors/src/index.js";
import { SQLiteFitnessRepository } from "../../packages/db/src/index.js";

export async function persistLocalEvidence({ dbPath, profileContext, events }) {
  await mkdir(dirname(dbPath), { recursive: true });
  const repository = new SQLiteFitnessRepository({ filename: dbPath });
  try {
    const existing = await repository.getUserContext(profileContext.user.id);
    const startingContext = existing || profileContext;
    const merged = applyNormalizedEventsToContext(startingContext, events);
    await repository.saveUserContext(merged);
    return merged;
  } finally {
    repository.close();
  }
}
