#!/usr/bin/env node
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRulePackage } from "../packages/rules/src/packageBoundary.js";
import { ENGINE_VERSION } from "../packages/decision-engine/src/version.js";

const root = fileURLToPath(new URL("..", import.meta.url));
for (const name of ["base_rules", "running_rules", "strength_rules", "single_workout_rules"]) {
  const result = validateRulePackage(join(root, "rule-packages", name), { engineVersion: ENGINE_VERSION });
  console.log(`${name}@${result.manifest.version}: valid (${result.manifest.contentChecksum})`);
}
