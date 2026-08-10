// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { loadBaseRulePackage, loadRulePackage } from "./packageBoundary.js";

/**
 * The rule library as text, kept behind one module so the build can replace it.
 *
 * Read from disk when running from source, so editing `session-rules.json`
 * changes what Evidra decides without a build step. The packed bundle replaces
 * this module with the same JSON inlined as a string literal (see
 * `scripts/build-bundle.js`), which is why no `session-rules.json` travels
 * inside the `.mcpb`.
 */
const packageData = process.env.EVIDRA_RULE_PACKAGE_DIR
  ? loadRulePackage(process.env.EVIDRA_RULE_PACKAGE_DIR)
  : loadBaseRulePackage();
export const librarySourceJson = packageData.ruleFiles.get("rules/session-rules.json").rules
  ? JSON.stringify(packageData.ruleFiles.get("rules/session-rules.json"))
  : "";
