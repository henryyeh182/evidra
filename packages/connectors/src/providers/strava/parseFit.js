import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

/**
 * The smallest FIT reader that answers one question: where was the athlete?
 *
 * Strava's bulk export dates every activity in UTC and carries no offset
 * anywhere in the CSVs. The offset survives in exactly one place — the FIT
 * file's `activity` message, which records both `timestamp` (UTC) and
 * `local_timestamp` (the same instant on the athlete's wall clock). Their
 * difference is the offset, and it is the only thing this module extracts.
 *
 * Deliberately not a FIT library. It walks the record stream to stay aligned,
 * decodes values only for the messages it wants, and skips everything else by
 * declared size. Streams, laps, GPS — none of it is read, so none of it is
 * held.
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
const FIELD_TIMESTAMP = 253;
const FIELD_LOCAL_TIMESTAMP = 5;

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
 * Walk a decompressed FIT buffer and return the `activity` message's UTC and
 * local timestamps, in FIT seconds.
 *
 * @param {Buffer} buffer
 * @returns {{ timestamp: number|null, localTimestamp: number|null }|null}
 */
function readActivityTimestamps(buffer) {
  if (buffer.length < 14 || buffer.toString("latin1", 8, 12) !== ".FIT") {
    throw new Error("Not a FIT file: missing .FIT signature.");
  }

  const headerSize = buffer.readUInt8(0);
  const dataEnd = Math.min(headerSize + buffer.readUInt32LE(4), buffer.length);

  const definitions = new Map();
  let position = headerSize;
  let found = null;

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

    const wanted = definition.globalMessage === GLOBAL_ACTIVITY;
    for (const field of definition.fields) {
      if (wanted && (field.number === FIELD_TIMESTAMP || field.number === FIELD_LOCAL_TIMESTAMP)) {
        const value = readScalar(buffer, position, field.size, field.baseType, definition.littleEndian);
        found ??= { timestamp: null, localTimestamp: null };
        if (field.number === FIELD_TIMESTAMP) found.timestamp = value;
        else found.localTimestamp = value;
      }
      position += field.size;
    }
  }

  return found;
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
