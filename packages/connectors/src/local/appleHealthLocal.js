// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { LocalConnectorAdapter } from "../local.js";
import { findLatestExportFile } from "./latestExportFile.js";
import { parseAppleHealthExport, normalizeAppleHealthExport } from "../providers/apple-health/index.js";

const DEFAULT_BASE_DIR = "data/private/export_apple_health";

/**
 * Reads whatever Apple Health `export.xml` is newest under `baseDir` and
 * normalizes it with the already-validated parser (see
 * packages/connectors/src/providers/apple-health, checked against a real
 * export per CLAUDE.md 2.1). No provider token or network involved — this is
 * the same parser scripts/import-apple-health.js already uses against a
 * fixed path; this adapter only adds the folder scan.
 */
export class AppleHealthLocalConnector extends LocalConnectorAdapter {
  constructor({ baseDir = DEFAULT_BASE_DIR } = {}) {
    super({ provider: "apple_health" });
    this.baseDir = baseDir;
  }

  async pullNormalizedEvents() {
    const exportPath = await findLatestExportFile(this.baseDir, /^export.*\.xml$/i);
    if (!exportPath) return [];

    const parsed = await parseAppleHealthExport(exportPath);
    return normalizeAppleHealthExport(parsed);
  }
}
