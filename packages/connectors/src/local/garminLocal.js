// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Garmin's "Export Your Data" (GDPR request) archive is a *different dialect*
// from the shape packages/connectors/src/providers/garmin/normalize.js reads
// (documented in schemas/sources/garmin.export.json). Two real gaps, found by
// reading an actual archive (DI_CONNECT/DI-Connect-Wellness/*_sleepData.json,
// DI-Connect-Aggregator/UDSFile_*.json — not simulated):
//
//   1. Sleep: this archive's daily record has no `sleepTimeSeconds` field at
//      all (every file, every record). What it has instead is
//      deepSleepSeconds + lightSleepSeconds + remSleepSeconds (awake time
//      already excluded — Garmin tracks it separately as
//      awakeSleepSeconds). And the score sits at `sleepScores.overallScore`,
//      not `sleepScores.overall.value`.
//   2. Stress: this archive nests the daily average inside
//      `allDayStress.aggregatorList`, one entry per segment
//      (TOTAL/ASLEEP/AWAKE) rather than a flat `averageStressLevel` field.
//      Only the TOTAL entry is the whole-day figure the existing normalizer
//      expects.
//
// Everything else — readiness (TrainingReadinessDTO), health status
// (healthStatusData), resting HR / steps / body battery (also in UDSFile),
// and activities (summarizedActivities) — already matches the existing
// normalizer's expected fields directly; those are read as-is. This module's
// job is only to bridge the two dialects, not to recompute anything the
// normalizer already does.
import { readFile } from "node:fs/promises";

import { LocalConnectorAdapter } from "../local.js";
import { findAllExportFiles } from "./latestExportFile.js";
import { buildGarminEvidence } from "../providers/garmin/index.js";

const DEFAULT_BASE_DIR = "data/private/export_garmin/DI_CONNECT";

async function readJsonFiles(paths) {
  const contents = [];
  for (const path of paths) {
    try {
      contents.push(JSON.parse(await readFile(path, "utf8")));
    } catch {
      // A file that fails to parse is treated as absent, not fatal — one
      // corrupt window should not take down the whole import.
    }
  }
  return contents;
}

/** UDSFile's daily stress figure lives under allDayStress.aggregatorList; only
 * the TOTAL segment is the whole-day average the normalizer expects at
 * `averageStressLevel`. */
function flattenDailySummary(record) {
  const total = record.allDayStress?.aggregatorList?.find((entry) => entry.type === "TOTAL");
  return {
    ...record,
    averageStressLevel: typeof total?.averageStressLevel === "number" ? total.averageStressLevel : undefined
  };
}

/** This archive has no sleepTimeSeconds or sleepScores.overall.value field;
 * both are derived from fields that are present. A record with none of the
 * three stage seconds present (the `{ retro: false }` placeholder rows this
 * archive ships for nights outside its window) yields no sleepTimeSeconds,
 * which the existing normalizer already treats as absent. */
function flattenSleep(record) {
  const stages = [record.deepSleepSeconds, record.lightSleepSeconds, record.remSleepSeconds];
  const known = stages.filter((seconds) => typeof seconds === "number");
  const sleepTimeSeconds = known.length > 0 ? known.reduce((sum, seconds) => sum + seconds, 0) : undefined;

  return {
    ...record,
    sleepTimeSeconds,
    sleepScores:
      typeof record.sleepScores?.overallScore === "number"
        ? { overall: { value: record.sleepScores.overallScore } }
        : undefined
  };
}

function dedupeByCalendarDate(records) {
  const byDay = new Map();
  for (const record of records) {
    if (!record.calendarDate) continue;
    byDay.set(record.calendarDate, record); // later window wins, same as a re-export overwriting an earlier one
  }
  return [...byDay.values()];
}

async function readGarminExportFolder(baseDir) {
  const [readinessFiles, udsFiles, sleepFiles, healthStatusFiles, activityFiles] = await Promise.all([
    findAllExportFiles(baseDir, /^TrainingReadinessDTO_.*\.json$/i),
    findAllExportFiles(baseDir, /^UDSFile_.*\.json$/i),
    findAllExportFiles(baseDir, /_sleepData\.json$/i),
    findAllExportFiles(baseDir, /_healthStatusData\.json$/i),
    findAllExportFiles(baseDir, /_summarizedActivities\.json$/i)
  ]);

  const readiness = dedupeByCalendarDate((await readJsonFiles(readinessFiles)).flat());
  const dailySummaries = dedupeByCalendarDate((await readJsonFiles(udsFiles)).flat().map(flattenDailySummary));
  const sleep = dedupeByCalendarDate((await readJsonFiles(sleepFiles)).flat().map(flattenSleep));
  const healthStatus = dedupeByCalendarDate((await readJsonFiles(healthStatusFiles)).flat());

  // summarizedActivities wraps the array in { summarizedActivitiesExport: [...] }
  // and the export can be paginated across more than one numbered file.
  const activities = (await readJsonFiles(activityFiles))
    .flat()
    .flatMap((page) => page.summarizedActivitiesExport ?? []);

  return { readiness, dailySummaries, sleep, healthStatus, activities };
}

/**
 * Reads a Garmin "Export Your Data" archive's DI_CONNECT folder and
 * normalizes it via the existing Garmin evidence builder. `baseDir` should
 * point at the archive's DI_CONNECT directory (the export ships several
 * unrelated top-level folders alongside it; only DI_CONNECT carries the
 * wellness/fitness data this reads).
 */
export class GarminLocalConnector extends LocalConnectorAdapter {
  constructor({ baseDir = DEFAULT_BASE_DIR, sinceDays, asOf } = {}) {
    super({ provider: "garmin" });
    this.baseDir = baseDir;
    this.sinceDays = sinceDays;
    this.asOf = asOf;
  }

  async pullNormalizedEvents() {
    const parts = await readGarminExportFolder(this.baseDir);
    const hasAnyData =
      parts.readiness.length + parts.dailySummaries.length + parts.sleep.length +
      parts.healthStatus.length + parts.activities.length > 0;
    if (!hasAnyData) return [];

    const evidence = buildGarminEvidence(parts, { sinceDays: this.sinceDays, asOf: this.asOf });
    return [
      ...evidence.healthMetrics.map((event) => ({ ...event, kind: "health_metric" })),
      ...evidence.vendorAssessments.map((event) => ({ ...event, kind: "vendor_assessment" })),
      ...evidence.workouts
    ];
  }
}

export { readGarminExportFolder };
