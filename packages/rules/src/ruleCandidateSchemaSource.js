// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The rule-candidate JSON Schema as text, kept behind one module so the build
 * can replace it — same pattern as packages/rules/src/librarySource.js and
 * packages/db/src/sqliteSchemaSource.js.
 *
 * Read from disk relative to this file when running from source. Bundling
 * collapses the module tree into one file, so a path built from
 * `import.meta.url` inside the packed `.mcpb` no longer sits the same number
 * of directories from `rule-packages/` on disk; the packed bundle replaces
 * this module with the schema inlined as a string literal (see
 * scripts/build-bundle.js's `layoutShims`).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../rule-packages");
export const ruleCandidateSchemaJson = readFileSync(join(ROOT, "schemas/rule-candidate.schema.json"), "utf8");
