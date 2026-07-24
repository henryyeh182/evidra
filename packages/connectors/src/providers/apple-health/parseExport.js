import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Apple Health exports (`apple_health_export/export.xml`) are frequently
// hundreds of MB. We stream line by line rather than loading the whole file,
// and pull attributes off the opening <Record ...> / <Workout ...> tags — the
// fields we need all live on the opening tag, so nested <MetadataEntry> lines
// can be ignored. Dependency-free on purpose (no XML library).

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(line) {
  const attrs = {};
  let match;
  while ((match = ATTR_RE.exec(line)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Stream an Apple Health export.xml and collect the raw Record/Workout tags.
 *
 * @param {string} filePath
 * @param {{ recordTypes?: Set<string> }} [options] optional allow-list of
 *   HK*TypeIdentifier values to keep (keeps memory bounded on huge exports).
 * @returns {Promise<{ records: object[], workouts: object[] }>}
 */
export async function parseAppleHealthExport(filePath, options = {}) {
  const { recordTypes } = options;
  const records = [];
  const workouts = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (line.includes("<Record ")) {
      const attrs = parseAttributes(line);
      if (!recordTypes || recordTypes.has(attrs.type)) {
        records.push(attrs);
      }
    } else if (line.includes("<Workout ")) {
      workouts.push(parseAttributes(line));
    }
  }

  return { records, workouts };
}

/**
 * Parse an export from an in-memory XML string. Convenience for tests and small
 * fixtures; the streaming variant above is what production import uses.
 *
 * @param {string} xml
 * @returns {{ records: object[], workouts: object[] }}
 */
export function parseAppleHealthExportString(xml) {
  const records = [];
  const workouts = [];
  for (const line of xml.split(/\r?\n/)) {
    if (line.includes("<Record ")) {
      records.push(parseAttributes(line));
    } else if (line.includes("<Workout ")) {
      workouts.push(parseAttributes(line));
    }
  }
  return { records, workouts };
}
