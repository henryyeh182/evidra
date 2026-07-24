// Import a real Apple Health export from data/private/ (git-ignored), normalize
// it, write the normalized dataset back into data/private/, and print a Semantic
// Fitness State computed from the real data. Nothing here is committed.
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseAppleHealthExport,
  normalizeAppleHealthExport,
  applyNormalizedEventsToContext
} from "../packages/connectors/src/index.js";
import { generateSemanticFitnessState } from "../packages/semantic-engine/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const exportPath = join(rootDir, "data/private/apple-health/export.xml");
const outputPath = join(rootDir, "data/private/apple-health/normalized.json");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(exportPath))) {
    console.log(`No export found at:\n  ${exportPath}\n`);
    console.log("Drop your Apple Health export.xml there first. See data/private/README.md.");
    process.exitCode = 1;
    return;
  }

  console.log(`Parsing ${exportPath} ...`);
  const parsed = await parseAppleHealthExport(exportPath);
  console.log(`  records: ${parsed.records.length}, workouts: ${parsed.workouts.length}`);

  const events = normalizeAppleHealthExport(parsed);
  const workouts = events.filter((e) => e.kind === "workout");
  const metrics = events.filter((e) => e.kind === "health_metric");
  console.log(`  normalized: ${workouts.length} workouts, ${metrics.length} health metrics`);

  await writeFile(outputPath, JSON.stringify(events, null, 2));
  console.log(`  wrote ${outputPath} (git-ignored)`);

  const context = JSON.parse(await readFile(join(rootDir, "data/seeds/sample-user-context.json"), "utf8"));
  const merged = applyNormalizedEventsToContext(context, events);

  const latest = metrics.map((m) => m.recordedAt).sort().at(-1);
  const date = (latest || "2026-07-22").slice(0, 10);
  const state = generateSemanticFitnessState(merged, { date, timezone: context.user.timezone });

  console.log(`\nSemantic Fitness State from your data (${date}):`);
  console.log(`  recovery ${state.recoveryScore}  readiness ${state.readinessScore}  fatigue ${state.fatigueScore}`);
  console.log(`  recommended focus: ${state.recommendedFocus}`);
  console.log(`  confidence: ${state.confidence}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
