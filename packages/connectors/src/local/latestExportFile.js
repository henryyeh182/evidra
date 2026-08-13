// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Local export folders accumulate more than one download over time (a user
// re-exports every few months and drops the new archive next to the old
// one). "Latest" here means newest file mtime — the timestamp the filesystem
// itself recorded when the export was written to disk, not a value read out
// of file content. That is a real, checkable fact (`fs.stat().mtimeMs`), not
// a guess, which is what the no-unsourced-values rule asks for.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively find every file directly under `baseDir` (or one level of
 * subdirectories — export folders are sometimes date-stamped,
 * e.g. `export_apple_health/2026-08-01/export.xml`) whose name matches
 * `namePattern`, and return the newest one by mtime. Returns null when
 * nothing matches, which callers treat as "this source is absent" rather
 * than an error — a local connector's export folder is optional by design.
 */
export async function findLatestExportFile(baseDir, namePattern, { maxDepth = 2 } = {}) {
  const candidates = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // baseDir does not exist — the source was never exported here
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(fullPath, depth + 1);
        continue;
      }
      if (namePattern.test(entry.name)) {
        const info = await stat(fullPath);
        candidates.push({ path: fullPath, mtimeMs: info.mtimeMs });
      }
    }
  }

  await walk(baseDir, 0);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
}

/**
 * Same idea, but returns every matching file (newest first) instead of just
 * the newest. Garmin's bulk export windows history across several files with
 * overlapping date ranges in their names (`TrainingReadinessDTO_20260126_20260506_*.json`,
 * `TrainingReadinessDTO_20260506_20260814_*.json`, ...) — reading only the
 * "latest" file would silently drop the earlier windows, so a connector that
 * needs full history reads all of them and merges by day.
 */
export async function findAllExportFiles(baseDir, namePattern, { maxDepth = 2 } = {}) {
  const candidates = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(fullPath, depth + 1);
        continue;
      }
      if (namePattern.test(entry.name)) {
        const info = await stat(fullPath);
        candidates.push({ path: fullPath, mtimeMs: info.mtimeMs });
      }
    }
  }

  await walk(baseDir, 0);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates.map((c) => c.path);
}
