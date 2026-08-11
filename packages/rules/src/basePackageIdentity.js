// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../rule-packages/base_rules/package.json"
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

/** The distributable rule identity exposed to MCP clients and release gates. */
export const BASE_RULE_PACKAGE_IDENTITY = Object.freeze({
  packageId: manifest.packageId,
  version: manifest.version,
  contentChecksum: manifest.contentChecksum
});
