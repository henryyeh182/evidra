// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { computeTimeInZone } from "../../timeInZone.js";

/**
 * The Heart Rate Analysis a Strava export does not contain.
 *
 * Strava computes this on its site and ships neither the distribution nor the
 * zone boundaries in the bulk export — `general_preferences.csv` carries pace
 * zones and nothing else. So the boundaries have to come from the caller (the
 * AI layer holds the athlete's authorization and can read them off the athlete's
 * own settings), while the per-second heart rate comes out of the FIT file the
 * export does ship.
 *
 * That split is the architecture working as intended rather than a workaround:
 * evidence arrives through the call, computation happens here, and what goes
 * back is an aggregate — seconds per zone — not the heartbeat trace it was
 * derived from.
 */

/**
 * Read one activity's FIT stream and return how long the athlete spent in each
 * heart-rate zone.
 *
 * @param {string} filePath  `activities/<id>.fit.gz`, or an uncompressed `.fit`
 * @param {import("../../timeInZone.js").HeartRateZone[]} zones supplied by the caller
 * @param {{ boundarySource?: string, maxSampleGapSeconds?: number }} [options]
 *   `boundarySource` records whose zone table this is (e.g. "strava_default").
 *   It travels with the answer because a distribution is only interpretable
 *   against the boundaries that produced it.
 * @returns {Promise<object|null>} null when the FIT file is absent or unreadable —
 *   a pruned export is still a usable export, it just cannot answer this.
 */
export async function readStravaActivityIntensity(filePath, zones, options = {}) {
  let raw;
  try {
    raw = await readFile(filePath);
  } catch {
    return null;
  }

  let samples;
  try {
    const buffer = filePath.endsWith(".gz") ? gunzipSync(raw) : raw;
    // Imported lazily so the FIT reader stays out of the path of callers who
    // only ever touch CSVs.
    const { readFitHeartRateSamples } = await import("./parseFit.js");
    samples = readFitHeartRateSamples(buffer);
  } catch {
    return null;
  }

  if (samples.length < 2) return null;

  const distribution = computeTimeInZone(samples, zones, options);

  return {
    basis: "heart_rate_zones",
    // Computed here from the athlete's own samples, not copied from a vendor
    // panel. The difference matters when the two disagree.
    derivation: "computed_from_recorded_stream",
    boundarySource: options.boundarySource || "caller_supplied",
    ...distribution
  };
}
