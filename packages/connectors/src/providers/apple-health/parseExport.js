// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Apple Health exports (`apple_health_export/export.xml`) are frequently
// hundreds of MB. We stream line by line rather than loading the whole file.
// Dependency-free on purpose (no XML library).
//
// Record fields all live on the opening tag, so their nested <MetadataEntry>
// lines can be ignored. Workouts cannot be read that way: in the dialect Apple
// writes today, a workout's energy and distance are not attributes at all but
// nested <WorkoutStatistics> elements, and a parser that only read the opening
// tag reported every session as having no load. So a workout stays open until
// </Workout> and collects the statistics underneath it.

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(line) {
  const attrs = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(line)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/**
 * Feed one line into the parse state.
 *
 * Kept separate so the streaming reader and the in-memory string reader agree
 * on every dialect question by construction rather than by being kept in sync.
 */
function consumeLine(line, state) {
  if (line.includes("<Record ")) {
    const attrs = parseAttributes(line);
    if (!state.recordTypes || state.recordTypes.has(attrs.type)) {
      state.records.push(attrs);
    }
    return;
  }

  if (line.includes("<Workout ")) {
    const workout = parseAttributes(line);
    workout.statistics = {};
    // A workout with no children closes on its own line and has no statistics.
    if (/\/>\s*$/.test(line)) state.workouts.push(workout);
    else state.openWorkout = workout;
    return;
  }

  if (state.openWorkout && line.includes("<WorkoutStatistics")) {
    const stat = parseAttributes(line);
    if (stat.type) state.openWorkout.statistics[stat.type] = stat;
    return;
  }

  if (state.openWorkout && line.includes("</Workout>")) {
    state.workouts.push(state.openWorkout);
    state.openWorkout = null;
  }
}

function newState(recordTypes) {
  return { records: [], workouts: [], openWorkout: null, recordTypes };
}

function finish(state) {
  // A truncated export can end mid-workout. Keep what was read rather than
  // dropping the session entirely.
  if (state.openWorkout) {
    state.workouts.push(state.openWorkout);
    state.openWorkout = null;
  }
  return { records: state.records, workouts: state.workouts };
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
  const state = newState(options.recordTypes);

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) consumeLine(line, state);

  return finish(state);
}

/**
 * Parse an export from an in-memory XML string. Convenience for tests and small
 * fixtures; the streaming variant above is what production import uses.
 *
 * @param {string} xml
 * @returns {{ records: object[], workouts: object[] }}
 */
export function parseAppleHealthExportString(xml) {
  const state = newState(undefined);
  for (const line of xml.split(/\r?\n/)) consumeLine(line, state);
  return finish(state);
}
