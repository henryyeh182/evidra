// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Google Health API v4 (REST) → Fitness Evidence Model.
//
// This is the *API* dialect of Google Health, not the Takeout dialect that
// packages/connectors/src/providers/google-health/ already reads. Same
// platform, different shapes: the export ships CSV/JSON files with Fitbit
// column names, the API ships typed dataPoints under
// https://health.googleapis.com/v4/users/me/dataTypes/<kebab-name>/dataPoints.
//
// It reads whatever raw responses are already in data/private/export_google_health/raw/
// (put there by Codelab.http or by curl), converts, writes evidence.json,
// merges it into the local SQLite user context so evidra_local_decide_today
// can use it, and prints a Semantic Fitness State computed from it. Nothing
// here is committed; nothing here is on the hosted server's import path.
//
// The reader and normalizer live in
// packages/connectors/src/local/googleHealthApiLocal.js — this script is a
// thin CLI wrapper (reuses them via readGoogleHealthApiRawFolder /
// buildGoogleHealthApiEvidence, which packages/connectors/src/local/assembleLocalEvidence.js
// also calls) so the two entry points cannot drift apart.
//
// Measured on one real account, 2026-08-06 (Garmin watch → Garmin Connect →
// Apple HealthKit → Google Health → API, `platform: HEALTH_KIT`):
//
//   exercise                  9 sessions, caloriesKcal on 9/9  ← the load line
//   daily-resting-heart-rate  13 days over a 24-day window
//   sleep                     6 nights, full stage summary
//   heart-rate-variability    0   ← Garmin Connect's HealthKit write list has
//   daily-heart-rate-variability 0   no HRV entry at all, so nothing upstream
//   active-zone-minutes       0   ← needs a Fitbit/Pixel device
//   vo2-max / daily-vo2-max   0
//   exerciseMetadata          {} on all 9 — no `intensity` field exists
//
// So this dialect carries a complete training side and a recovery side of
// resting HR plus sleep. hrv lands in signalCoverage.recovery.missing, which
// is the point: an absent signal is reported, never guessed.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readGoogleHealthApiRawFolder, buildGoogleHealthApiEvidence } from "../packages/connectors/src/local/googleHealthApiLocal.js";
import { generateSemanticFitnessState } from "../packages/semantic-engine/src/index.js";
import { persistLocalEvidence } from "./lib/persistLocalEvidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const baseDir = join(rootDir, "data/private/export_google_health");
const rawDir = join(baseDir, "raw");
const outputPath = join(baseDir, "evidence.json");
const privateProfilePath = join(rootDir, "data/private/my-user-context.json");
const demoProfilePath = join(rootDir, "data/seeds/sample-user-context.json");
const dbPath = process.env.PACEVERA_DB_PATH || join(rootDir, "data/private/pacevera.sqlite");

async function main() {
  const { raw, report } = await readGoogleHealthApiRawFolder(rawDir);
  if (!raw) {
    console.log(`No raw responses at:\n  ${rawDir}\n`);
    console.log("Run the requests in data/private/export_google_health/Codelab.http first.");
    process.exitCode = 1;
    return;
  }

  for (const [key, info] of Object.entries(report)) {
    const from = info.file ? info.file : "(absent)";
    const note = info.truncated ? " — TRUNCATED, more pages exist" : "";
    console.log(`  ${key.padEnd(18)} ${String(info.count).padStart(3)} dataPoints  ${from}${note}`);
  }

  const evidence = buildGoogleHealthApiEvidence(raw);
  const withLoad = evidence.workouts.filter((w) => w.trainingLoad !== null).length;
  console.log(
    `\n  normalized: ${evidence.workouts.length} workouts (${withLoad} with load), ` +
      `${evidence.healthMetrics.length} health metrics`
  );

  const types = new Set(evidence.healthMetrics.map((m) => m.type));
  console.log(`  metric types present: ${[...types].join(", ") || "(none)"}`);
  for (const expected of ["hrv_ms", "sleep_quality", "stress"]) {
    if (!types.has(expected)) console.log(`  absent: ${expected} — no source in this dialect`);
  }

  await writeFile(outputPath, JSON.stringify(evidence, null, 2));
  console.log(`\n  wrote ${outputPath} (git-ignored)`);

  // Prefer your real, git-ignored profile; fall back to the demo seed so the
  // script still runs out of the box.
  const usingRealProfile = await fileExists(privateProfilePath);
  const profilePath = usingRealProfile ? privateProfilePath : demoProfilePath;
  const context = JSON.parse(await readFile(profilePath, "utf8"));
  console.log(`  profile: ${usingRealProfile ? "data/private/my-user-context.json (yours)" : "demo seed"}`);

  const events = [...evidence.healthMetrics, ...evidence.workouts];

  // Merges into whatever is already saved for this user (other sources'
  // workouts and health metrics included), not just this run's events on top
  // of the blank profile — see scripts/lib/persistLocalEvidence.js.
  const merged = await persistLocalEvidence({ dbPath, profileContext: context, events });
  console.log(`  saved user context to ${dbPath} (userId: ${merged.user.id}, ${merged.workouts.length} workouts total, ${merged.healthMetrics.length} health metrics total)`);

  const latest = events.map((e) => e.recordedAt ?? e.startedAt).sort().at(-1);
  if (!latest) {
    console.log("\nNo dated evidence — nothing to compute a state from.");
    return;
  }
  const date = latest.slice(0, 10);
  const state = generateSemanticFitnessState(merged, { date, timezone: context.user?.timezone });

  console.log(`\nSemantic Fitness State from your Google Health data (${date}):`);
  console.log(`  recovery ${state.recoveryScore}  readiness ${state.readinessScore}  fatigue ${state.fatigueScore}`);
  console.log(`  recommended focus: ${state.recommendedFocus}`);
  console.log(`  confidence: ${state.confidence}`);
  if (state.signalCoverage) {
    console.log(`  signalCoverage: ${JSON.stringify(state.signalCoverage)}`);
  }
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
