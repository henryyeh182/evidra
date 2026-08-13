// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Combines what the four per-source scripts (import-apple-health.js,
// import-google-health-api.js, and the Garmin/Strava local connectors) do
// separately: scan data/private/ for whatever local exports exist, merge
// them into one Evidence context, persist workouts/health metrics to the
// local SQLite user context, and decide today's session — all in one
// process, without any MCP `evidence` argument ever crossing a tool
// boundary. Evidence Flow Story 3.
//
// The decision step deliberately does NOT re-read the context back out of
// SQLite: the repository does not persist vendor_assessment evidence
// (Garmin's recoveryTime, Body Battery — see packages/private-engine/src/index.js),
// so this passes the freshly assembled in-memory context straight into
// LocalPrivateEngine.decideToday via its `context` override instead.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { assembleLocalEvidence } from "../packages/connectors/src/local/assembleLocalEvidence.js";
import { SQLiteFitnessRepository } from "../packages/db/src/index.js";
import { LocalPrivateEngine } from "../packages/private-engine/src/index.js";
import { persistLocalEvidence } from "./lib/persistLocalEvidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const baseDir = join(rootDir, "data/private");
const privateProfilePath = join(rootDir, "data/private/my-user-context.json");
const demoProfilePath = join(rootDir, "data/seeds/sample-user-context.json");
const dbPath = process.env.PACEVERA_DB_PATH || join(rootDir, "data/private/pacevera.sqlite");

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const usingRealProfile = await fileExists(privateProfilePath);
  const profilePath = usingRealProfile ? privateProfilePath : demoProfilePath;
  const profileContext = JSON.parse(await readFile(profilePath, "utf8"));
  console.log(`profile: ${usingRealProfile ? "data/private/my-user-context.json (yours)" : "demo seed"}`);

  const { events, sources } = await assembleLocalEvidence({ baseDir });
  for (const [name, info] of Object.entries(sources)) {
    console.log(`  ${name.padEnd(12)} ${info.status}${info.eventCount ? ` (${info.eventCount} events)` : ""}${info.error ? ` — ${info.error}` : ""}`);
  }
  if (events.length === 0) {
    console.log("\nNo local exports found under data/private/. Nothing to decide from.");
    return;
  }

  // Persists workouts/healthMetrics (same merge as the per-source scripts)
  // and returns the merged in-memory context — which, unlike a repository
  // read, still carries this run's vendor_assessment events.
  const merged = await persistLocalEvidence({ dbPath, profileContext, events });
  console.log(`\nsaved to ${dbPath} (userId: ${merged.user.id}, ${merged.workouts.length} workouts, ${merged.healthMetrics.length} health metrics, ${merged.vendorAssessments?.length ?? 0} vendor assessments)`);

  const latest = [...merged.healthMetrics, ...merged.workouts]
    .map((e) => e.recordedAt ?? e.startedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest) {
    console.log("\nNo dated evidence — nothing to compute a decision from.");
    return;
  }
  const date = latest.slice(0, 10);

  const repository = new SQLiteFitnessRepository({ filename: dbPath });
  try {
    const engine = new LocalPrivateEngine({ repository });
    const decision = await engine.decideToday({ userId: merged.user.id, date, context: merged });

    console.log(`\nDecision for ${date} (evidenceSource: ${decision.provenance.evidenceSource}):`);
    console.log(`  ${decision.decision.type} / ${decision.decision.intent} · confidence ${decision.confidence}`);
    if (decision.action?.from) {
      console.log(`  from ${decision.action.from.focus} · ${decision.action.from.durationMinutes}min`);
      console.log(`  to   ${decision.action.to.focus} · ${decision.action.to.durationMinutes}min`);
    }
    (decision.reason ?? []).forEach((line) => console.log(`  ↳ ${line}`));
    if (decision.signalCoverage) {
      console.log(`  signalCoverage.recovery.missing: ${decision.signalCoverage.recovery.missing.join(", ") || "(none)"}`);
      console.log(`  signalCoverage.training.missing: ${decision.signalCoverage.training.missing.join(", ") || "(none)"}`);
    }
  } finally {
    repository.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
