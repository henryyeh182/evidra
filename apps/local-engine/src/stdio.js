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

const repository = new SQLiteFitnessRepository({ filename: configuredDbPath });
const handleMessage = createLocalMcpHandler({
  engine: new LocalPrivateEngine({ repository }),
  ...(localEvidenceDir ? { localEvidenceDir } : {})
});

const lines = createInterface({ input: stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const response = await handleMessage(line);
  if (response !== null) stdout.write(`${JSON.stringify(response)}\n`);
}

repository.close();
