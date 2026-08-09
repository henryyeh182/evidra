// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";

/**
 * The engine parameter set as text, kept behind one module so the build can
 * replace it — the same arrangement as `librarySource.js`, for the same reason.
 *
 * Read from disk when running from source, so editing `engine-parameters.json`
 * changes what Evidra computes without a build step. The packed bundle replaces
 * this module with the JSON inlined as a string literal (see
 * `scripts/build-bundle.js`), which is why no `engine-parameters.json` travels
 * inside the `.mcpb`.
 */
export const parameterSourceJson = readFileSync(
  new URL("../data/engine-parameters.json", import.meta.url),
  "utf8"
);
