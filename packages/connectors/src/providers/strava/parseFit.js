// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

/**
 * The smallest FIT reader that answers two questions the CSVs cannot.
 *
 * 1. **Where was the athlete?** Strava's bulk export dates every activity in
 *    UTC and carries no offset anywhere in the CSVs. The offset survives in
 *    exactly one place — the `activity` message, which records both
 *    `timestamp` (UTC) and `local_timestamp` (the same instant on the
 *    athlete's wall clock). Their difference is the offset.
 *
 * 2. **How hard was it, minute by minute?** Strava shows a Heart Rate Analysis
 *    on its site; the bulk export contains neither the distribution nor the
 *    zone boundaries it was computed against. Both are recoverable: the `record`
 *    messages carry the per-second heart rate, and given boundaries the
 *    distribution is arithmetic, not a guess. Verified against Strava's own
 *    panel for a real 35-minute session — every zone agreed to the second.
 *
 * Still not a FIT library. It walks the record stream to stay aligned, decodes
 * only the fields these two answers need, and skips everything else by declared
 * size. GPS, power, cadence, laps — never read, so never held. The heart-rate
 * samples are read to be aggregated: what leaves this module should be seconds
 * per zone, not a stream of someone's heartbeats.
 */

/** FIT timestamps count seconds from 1989-12-31T00:00:00Z. */
const FIT_EPOCH_SECONDS = Date.UTC(1989, 11, 31) / 1000;

/** Base type number -> bytes. Indexed by `baseType & 0x1f`. */
const BASE_TYPE_SIZES = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

/**
 * "No value recorded" sentinels. A FIT field that was never filled reads as
 * all-ones, so 0xFFFFFFFF is not a timestamp 136 years in the future — it is
 * an absence, and it must not escape this module as a number.
 */
const INVALID = { 1: 0x7f, 2: 0xff, 3: 0x7fff, 4: 0xffff, 5: 0x7fffffff, 6: 0xffffffff };

const GLOBAL_ACTIVITY = 34;
const GLOBAL_RECORD = 20;
const FIELD_TIMESTAMP = 253;
const FIELD_LOCAL_TIMESTAMP = 5;
const FIELD_HEART_RATE = 3;

function readScalar(buffer, offset, size, baseType, littleEndian) {
  const base = baseType & 0x1f;
  if (BASE_TYPE_SIZES[base] !== size) return null; // array or string; not a scalar

  let value;
  switch (base) {
    case 1: case 2: case 0: case 10: case 13:
      value = buffer.readUInt8(offset);
      break;
    case 3: case 4: case 11:
      value = littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
      break;
    case 5: case 6: case 12:
      value = littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
      break;
    default:
      return null;
  }

  return value === INVALID[base] ? null : value;
}

/**
 * Walk a decompressed FIT buffer, decoding only the messages a caller asks for.
 *
 * The walk itself is the whole trick: every data message must be stepped over
 * by its declared size whether or not it is wanted, or the stream desynchronises
 * and every later message decodes into plausible nonsense.
 *
 * @param {Buffer} buffer
 * @param {(globalMessage: number) => boolean} wants
 * @param {(globalMessage: number, fields: Record<number, number|null>) => void} visit
 */
function walkMessages(buffer, wants, visit) {
  if (buffer.length < 14 || buffer.toString("latin1", 8, 12) !== ".FIT") {
    throw new Error("Not a FIT file: missing .FIT signature.");
  }

  const headerSize = buffer.readUInt8(0);
  const dataEnd = Math.min(headerSize + buffer.readUInt32LE(4), buffer.length);

  const definitions = new Map();
  let position = headerSize;

  while (position < dataEnd) {
    const recordHeader = buffer.readUInt8(position);
    position += 1;

    // Compressed timestamp header: a data message whose local type lives in
    // bits 5-6. Nothing to decode here, but the stream still has to stay
    // aligned, so it falls through to the data-message branch below.
    const compressed = (recordHeader & 0x80) !== 0;
    const isDefinition = !compressed && (recordHeader & 0x40) !== 0;
    const localType = compressed ? (recordHeader >> 5) & 0x03 : recordHeader & 0x0f;

    if (isDefinition) {
      position += 1; // reserved
      const littleEndian = buffer.readUInt8(position) === 0;
      position += 1;
      const globalMessage = littleEndian
        ? buffer.readUInt16LE(position)
        : buffer.readUInt16BE(position);
      position += 2;

      const fieldCount = buffer.readUInt8(position);
      position += 1;

      const fields = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({
          number: buffer.readUInt8(position),
          size: buffer.readUInt8(position + 1),
          baseType: buffer.readUInt8(position + 2)
        });
        position += 3;
      }

      // Developer fields carry no profile meaning here, but their sizes are
      // part of every subsequent data message and must be accounted for.
      if ((recordHeader & 0x20) !== 0) {
        const developerCount = buffer.readUInt8(position);
        position += 1;
        for (let i = 0; i < developerCount; i++) {
          fields.push({ number: -1, size: buffer.readUInt8(position + 1), baseType: 0x0d });
          position += 3;
        }
      }

      definitions.set(localType, { globalMessage, littleEndian, fields });
      continue;
    }

    const definition = definitions.get(localType);
    if (!definition) {
      throw new Error(`FIT stream out of sync: data message for undefined local type ${localType}.`);
    }

    const wanted = wants(definition.globalMessage);
    const fields = wanted ? {} : null;
    for (const field of definition.fields) {
      if (wanted && field.number >= 0) {
        fields[field.number] = readScalar(buffer, position, field.size, field.baseType, definition.littleEndian);
      }
      position += field.size;
    }
    if (wanted) visit(definition.globalMessage, fields);
  }
}

/**
 * The `activity` message's UTC and local timestamps, in FIT seconds.
 *
 * @param {Buffer} buffer
 * @returns {{ timestamp: number|null, localTimestamp: number|null }|null}
 */
function readActivityTimestamps(buffer) {
  let found = null;
  walkMessages(
    buffer,
    (global) => global === GLOBAL_ACTIVITY,
    (_global, fields) => {
      found ??= { timestamp: null, localTimestamp: null };
      if (fields[FIELD_TIMESTAMP] !== undefined) found.timestamp = fields[FIELD_TIMESTAMP];
      if (fields[FIELD_LOCAL_TIMESTAMP] !== undefined) found.localTimestamp = fields[FIELD_LOCAL_TIMESTAMP];
    }
  );
  return found;
}

/**
 * The per-second heart rate the athlete's device recorded.
 *
 * Returned as `{ timestamp, bpm }` in FIT seconds so a caller can weigh each
 * sample by how long it actually stood — devices drop samples, and treating a
 * gap as one second would quietly shorten the session. Samples the device did
 * not record read as absent, never as zero.
 *
 * This is the rawest thing this codebase touches. Aggregate it and let go of it:
 * seconds per zone is evidence, a stranger's heartbeat trace is not ours to keep.
 *
 * @param {Buffer} buffer a decompressed FIT file
 * @returns {Array<{ timestamp: number, bpm: number|null }>} ordered by time
 */
export function readFitHeartRateSamples(buffer) {
  const samples = [];
  walkMessages(
    buffer,
    (global) => global === GLOBAL_RECORD,
    (_global, fields) => {
      const timestamp = fields[FIELD_TIMESTAMP];
      if (timestamp === undefined || timestamp === null) return;
      samples.push({ timestamp, bpm: fields[FIELD_HEART_RATE] ?? null });
    }
  );
  return samples.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * The athlete's UTC offset at the moment of this activity.
 *
 * Sanity-bounded on purpose: a difference that is not a whole minute or that
 * exceeds the range of real civil offsets is a decoding failure wearing a
 * plausible number, and is reported as unknown rather than believed.
 *
 * @param {Buffer} buffer a decompressed FIT file
 * @returns {{ utcOffsetSeconds: number, startedAtUtc: string, startedAtLocalWallClock: string }|null}
 */
export function readFitLocalOffset(buffer) {
  const timestamps = readActivityTimestamps(buffer);
  if (!timestamps || timestamps.timestamp === null || timestamps.localTimestamp === null) {
    return null;
  }

  const utcOffsetSeconds = timestamps.localTimestamp - timestamps.timestamp;
  if (utcOffsetSeconds % 60 !== 0) return null;
  if (Math.abs(utcOffsetSeconds) > 14 * 3600) return null;

  const utcMs = (FIT_EPOCH_SECONDS + timestamps.timestamp) * 1000;
  const localMs = (FIT_EPOCH_SECONDS + timestamps.localTimestamp) * 1000;

  return {
    utcOffsetSeconds,
    startedAtUtc: new Date(utcMs).toISOString().replace(".000Z", "Z"),
    // Wall clock only — no zone attached, because a fixed offset is not a
    // timezone. It is what the athlete's watch read, nothing more.
    startedAtLocalWallClock: new Date(localMs).toISOString().slice(0, 19)
  };
}

/**
 * Read the offset out of one `activities/<id>.fit.gz` (or `.fit`).
 *
 * Returns null rather than throwing when the file is missing or unreadable:
 * an export whose FIT files were pruned is still a usable export, it just
 * cannot say what time it was where the athlete stood.
 *
 * @param {string} filePath
 */
export async function readStravaFitOffset(filePath) {
  let raw;
  try {
    raw = await readFile(filePath);
  } catch {
    return null;
  }

  try {
    const buffer = filePath.endsWith(".gz") ? gunzipSync(raw) : raw;
    return readFitLocalOffset(buffer);
  } catch {
    return null;
  }
}

/** "+08:00" / "-07:00" / "Z" for a whole-minute offset. */
export function formatUtcOffset(seconds) {
  if (seconds === 0) return "Z";
  const sign = seconds < 0 ? "-" : "+";
  const total = Math.abs(seconds) / 60;
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}
