// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { stat } from "node:fs/promises";
import { join } from "node:path";

import { LocalConnectorAdapter } from "../local.js";
import { findAllExportFiles } from "./latestExportFile.js";
import { parseStravaExport, normalizeStravaExport } from "../providers/strava/index.js";

const DEFAULT_BASE_DIR = "data/private/export_strava";

/** A Strava bulk export is a whole directory, not one file — the export root
 * itself if it holds activities.csv, otherwise the newest dated subfolder
 * that does. */
async function findLatestExportDirectory(baseDir) {
  const direct = join(baseDir, "activities.csv");
  try {
    const info = await stat(direct);
    return { directory: baseDir, mtimeMs: info.mtimeMs };
  } catch {
    // fall through to subfolder scan
  }

  const files = await findAllExportFiles(baseDir, /^activities\.csv$/i, { maxDepth: 1 });
  if (files.length === 0) return null;
  const info = await stat(files[0]);
  return { directory: files[0].slice(0, -"/activities.csv".length), mtimeMs: info.mtimeMs };
}

/**
 * Reads whatever Strava bulk export ("Download Request") is newest under
 * `baseDir` and normalizes it with the already-validated export parser (see
 * packages/connectors/src/providers/strava, checked against a real 39-file,
 * 7-activity export per CLAUDE.md 2.1). No provider token or network
 * involved.
 */
export class StravaLocalConnector extends LocalConnectorAdapter {
  constructor({ baseDir = DEFAULT_BASE_DIR, readLocalTimezone = false } = {}) {
    super({ provider: "strava" });
    this.baseDir = baseDir;
    this.readLocalTimezone = readLocalTimezone;
  }

  async pullNormalizedEvents() {
    const found = await findLatestExportDirectory(this.baseDir);
    if (!found) return [];

    const parsed = await parseStravaExport(found.directory, {
      readLocalTimezone: this.readLocalTimezone
    });
    return normalizeStravaExport(parsed);
  }
}
