// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The bundled build's answer to `apps/mcp-server/src/rootDir.js`.
 *
 * The packed bundle runs one file from `dist/`, so the data directories it
 * reads at runtime — `data/seeds`, `data/fixtures` — and `package.json` are one
 * level up, not three. `scripts/build-bundle.js` swaps this module in.
 */
export const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
