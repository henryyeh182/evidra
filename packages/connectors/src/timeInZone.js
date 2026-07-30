/**
 * Time in heart-rate zones, computed from the athlete's own samples.
 *
 * Strava and Garmin both show this on their sites and neither puts it in an
 * export. It is recoverable anyway, because the two things it is made of are:
 * the per-second heart rate (in the FIT file) and the zone boundaries (which
 * the caller supplies). Given both, the distribution is arithmetic.
 *
 * That distinction is the whole point of this module. Estimating an RPE from a
 * heart-rate ratio is inference — a guess at something nobody measured.
 * Counting how many seconds fell between 140 and 152 bpm is not: every input is
 * a recorded value, the rule is fixed, and the answer can be checked against
 * the vendor's own. It was: for a real 35-minute treadmill session this
 * reproduced Strava's Heart Rate Analysis panel to the second, in every zone.
 *
 * Two rules do the load-bearing work:
 *
 * - **A sample holds until the next one.** Devices drop samples; charging one
 *   second per reading would silently shorten a session with gaps. The last
 *   sample contributes nothing, because nothing bounds it.
 * - **A sample without a heart rate is not a low heart rate.** It goes to
 *   `unmeasuredSeconds` and is named, never folded into the recovery zone.
 */

/**
 * @typedef {object} HeartRateZone
 * @property {string} id           "Z1".."Z5" or whatever the caller's system calls them
 * @property {string} [name]       the vendor's label, carried through untouched
 * @property {number} [bpmMin]     inclusive; absent means "no lower bound"
 * @property {number} [bpmMax]     inclusive; absent means "no upper bound"
 */

/**
 * Reject a zone table that cannot produce a trustworthy answer.
 *
 * Overlapping zones would double-count seconds and still return a total that
 * looks right, which is the worst kind of wrong.
 *
 * @param {HeartRateZone[]} zones
 */
export function assertValidHeartRateZones(zones) {
  if (!Array.isArray(zones) || zones.length === 0) {
    throw new Error("Heart-rate zones must be a non-empty array.");
  }

  for (const zone of zones) {
    if (!zone || typeof zone.id !== "string" || zone.id.length === 0) {
      throw new Error("Every heart-rate zone needs an id.");
    }
    if (zone.bpmMin === undefined && zone.bpmMax === undefined) {
      throw new Error(`Zone ${zone.id} is unbounded on both sides, so every sample would match it.`);
    }
    if (zone.bpmMin !== undefined && zone.bpmMax !== undefined && zone.bpmMin > zone.bpmMax) {
      throw new Error(`Zone ${zone.id} has bpmMin ${zone.bpmMin} above bpmMax ${zone.bpmMax}.`);
    }
  }

  const ids = zones.map((zone) => zone.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Heart-rate zone ids must be unique.");
  }

  const ordered = [...zones].sort((a, b) => (a.bpmMin ?? -Infinity) - (b.bpmMin ?? -Infinity));
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    const previousMax = previous.bpmMax ?? Infinity;
    const currentMin = current.bpmMin ?? -Infinity;
    if (currentMin <= previousMax) {
      throw new Error(
        `Zones ${previous.id} and ${current.id} overlap at ${currentMin} bpm; seconds would be counted twice.`
      );
    }
  }

  return true;
}

function zoneFor(zones, bpm) {
  return zones.find(
    (zone) => (zone.bpmMin === undefined || bpm >= zone.bpmMin) && (zone.bpmMax === undefined || bpm <= zone.bpmMax)
  );
}

/**
 * Seconds spent in each zone.
 *
 * @param {Array<{ timestamp: number, bpm: number|null }>} samples ordered by time; timestamp in seconds
 * @param {HeartRateZone[]} zones
 * @param {{ maxSampleGapSeconds?: number }} [options]
 *   A gap longer than this is a pause, not a long-held heart rate. Seconds past
 *   the limit are reported as `gapSeconds` rather than credited to a zone —
 *   the alternative is letting one stale reading own ten minutes of standing
 *   still. Default 30.
 * @returns {{
 *   zones: Array<HeartRateZone & { seconds: number, percent: number }>,
 *   classifiedSeconds: number,
 *   unmeasuredSeconds: number,
 *   unclassifiedSeconds: number,
 *   gapSeconds: number,
 *   sampleCount: number
 * }}
 */
export function computeTimeInZone(samples, zones, options = {}) {
  assertValidHeartRateZones(zones);
  const maxGap = options.maxSampleGapSeconds ?? 30;

  const ordered = [...(samples || [])].sort((a, b) => a.timestamp - b.timestamp);
  const seconds = new Map(zones.map((zone) => [zone.id, 0]));
  let unmeasured = 0;
  let unclassified = 0;
  let gap = 0;

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const sample = ordered[i];
    const span = ordered[i + 1].timestamp - sample.timestamp;
    if (span <= 0) continue;

    const held = Math.min(span, maxGap);
    gap += span - held;

    if (sample.bpm === null || sample.bpm === undefined) {
      unmeasured += held;
      continue;
    }

    const zone = zoneFor(zones, sample.bpm);
    if (!zone) {
      // The zone table did not cover this reading. Saying so beats rounding it
      // into the nearest zone and reporting a total that adds up.
      unclassified += held;
      continue;
    }
    seconds.set(zone.id, seconds.get(zone.id) + held);
  }

  const classified = [...seconds.values()].reduce((total, value) => total + value, 0);

  return {
    zones: zones.map((zone) => ({
      ...zone,
      seconds: seconds.get(zone.id),
      // Percent of measured, classified time — not of wall-clock time. A
      // denominator that includes seconds the strap was off would report a
      // hard session as easy.
      percent: classified === 0 ? 0 : Number(((seconds.get(zone.id) / classified) * 100).toFixed(1))
    })),
    classifiedSeconds: classified,
    unmeasuredSeconds: unmeasured,
    unclassifiedSeconds: unclassified,
    gapSeconds: gap,
    sampleCount: ordered.length
  };
}
