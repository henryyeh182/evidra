// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";

/**
 * The SQLite schema as text, kept behind one module so the build can replace
 * it — same pattern as packages/rules/src/librarySource.js.
 *
 * Read from disk relative to this file when running from source. Bundling
 * collapses the module tree into one file, so `import.meta.url` inside the
 * packed `.mcpb` no longer sits next to `../schema/sqlite.sql` on disk; the
 * packed bundle replaces this module with the same file inlined as a string
 * literal (see scripts/build-bundle.js's `layoutShims`), which is why no
 * `schema/sqlite.sql` travels inside the archive.
 */
export const sqliteSchemaSql = readFileSync(new URL("../schema/sqlite.sql", import.meta.url), "utf8");
