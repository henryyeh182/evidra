// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { applyNormalizedEventsToContext } from "../normalization.js";
import { AppleHealthLocalConnector } from "./appleHealthLocal.js";
import { GarminLocalConnector } from "./garminLocal.js";
import { StravaLocalConnector } from "./stravaLocal.js";
import { GoogleHealthApiLocalConnector } from "./googleHealthApiLocal.js";
import { findAllExportFiles } from "./latestExportFile.js";

const EMPTY_CONTEXT = { workouts: [], healthMetrics: [], vendorAssessments: [] };

function firstExisting(...candidates) {
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

async function findMatchingDirectory(baseDir, pattern, maxDepth = 6) {
  const [match] = await findAllExportFiles(baseDir, pattern, { maxDepth });
  return match ? dirname(match) : null;
}

async function discoverSourceDirectories(baseDir) {
  const [appleHealth, strava, googleHealth] = await Promise.all([
    findMatchingDirectory(baseDir, /^export.*\.xml$/i),
    findMatchingDirectory(baseDir, /^activities\.csv$/i),
    findMatchingDirectory(baseDir, /^(exercise|resting-hr|sleep-nofilter)\.json$/i)
  ]);

  return {
    appleHealth,
    strava,
    googleHealth
  };
}

/**
 * Runs every local connector this user could plausibly have exported to
 * `baseDir` and merges whatever each one produced into `context` with the
 * existing applyNormalizedEventsToContext. A source with no export folder, an
 * empty one, or a folder that failed to parse is not an error here — it
 * contributes zero events, and downstream signalCoverage reports the gap
 * honestly (recovery/training .missing) rather than this function guessing a
 * value or refusing to run. `sources` records which of the four actually
 * produced anything, for callers that want to say so.
 *
 * No single source is required — see CLAUDE.md §3 "任何單一來源都必須能用":
 * this must run and produce a usable (if partial) context when only one of
 * the four folders exists.
 */
export async function assembleLocalEvidence({
  baseDir = "data/private",
  context = EMPTY_CONTEXT,
  appleHealthDir,
  garminDir,
  stravaDir,
  googleHealthRawDir
} = {}) {
  const discovered = await discoverSourceDirectories(baseDir);
  const connectors = {
    appleHealth: new AppleHealthLocalConnector({
      baseDir: appleHealthDir || discovered.appleHealth || firstExisting(join(baseDir, "export_apple_health"), join(baseDir, "apple-health"))
    }),
    // Garmin exports contain stable file signatures, but their enclosing
    // folder is not stable. Let the connector scan the selected root when no
    // conventional subfolder exists.
    garmin: new GarminLocalConnector({
      baseDir: garminDir || firstExisting(join(baseDir, "export_garmin/DI_CONNECT"), join(baseDir, "garmin/DI_CONNECT"), baseDir)
    }),
    strava: new StravaLocalConnector({
      baseDir: stravaDir || discovered.strava || firstExisting(join(baseDir, "export_strava"), join(baseDir, "strava"))
    }),
    googleHealth: new GoogleHealthApiLocalConnector({
      rawDir: googleHealthRawDir || discovered.googleHealth || firstExisting(join(baseDir, "export_google_health/raw"), join(baseDir, "google-health/raw"), join(baseDir, "google-health"))
    })
  };

  const events = [];
  const sources = {};

  for (const [name, connector] of Object.entries(connectors)) {
    try {
      const pulled = await connector.pullNormalizedEvents();
      events.push(...pulled);
      sources[name] = { status: pulled.length > 0 ? "present" : "absent", eventCount: pulled.length };
    } catch (error) {
      // A folder that exists but fails to parse (e.g. a Strava export missing
      // activities.csv after a partial download) is reported, not thrown —
      // one broken source must not take down the other three.
      sources[name] = { status: "error", eventCount: 0, error: error.message };
    }
  }

  const merged = applyNormalizedEventsToContext(context, events);
  return { context: merged, events, sources };
}
