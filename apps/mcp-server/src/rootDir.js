// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Where the runtime data files live, relative to the module asking for them.
 *
 * Three modules used to count `../../..` up from their own location, which is
 * correct only while they sit at `apps/mcp-server/src`. The packed bundle runs
 * a single file from `dist/`, so that count is wrong there. Anchoring on one
 * module means the build swaps this file (see `scripts/bundle-shims/`) and the
 * three callers stay identical in both layouts.
 */
export const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");
