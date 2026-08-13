// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";

import { SQLiteFitnessRepository } from "../../../packages/db/src/index.js";
import { LocalPrivateEngine } from "../../../packages/private-engine/src/index.js";
import { createLocalMcpHandler } from "./server.js";

const configuredDbPath = process.env.PACEVERA_DB_PATH || resolve("data/private/pacevera.sqlite");
if (configuredDbPath !== ":memory:") mkdirSync(dirname(configuredDbPath), { recursive: true });

// Set by the packaged .mcpb from the user_config directory picker
// (manifest.json's private_data_dir); undefined here falls back to
// localEvidence.js's own default (${HOME}/Pacevera) for anyone running this
// entry point directly.
const localEvidenceDir = process.env.PACEVERA_PRIVATE_DIR || undefined;

// A repository failure here (most likely: this runtime's Node predates 22.5
// and lacks node:sqlite — see packages/db/src/repository.js) must not take
// the whole process down. evidra_local_decide_today and outcome/decision
// persistence become unavailable; the four evidence-accepting tools do not
// need a repository and keep working (apps/local-engine/src/server.js).
let repository;
try {
  repository = new SQLiteFitnessRepository({ filename: configuredDbPath });
} catch (error) {
  console.error(`[pacevera] local SQLite store unavailable, continuing without it: ${error.message}`);
}

const handleMessage = createLocalMcpHandler({
  engine: repository ? new LocalPrivateEngine({ repository }) : undefined,
  ...(localEvidenceDir ? { localEvidenceDir } : {})
});

const lines = createInterface({ input: stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const response = await handleMessage(line);
  if (response !== null) stdout.write(`${JSON.stringify(response)}\n`);
}

repository?.close();
