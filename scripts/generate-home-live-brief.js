// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createLocalMcpHandler } from "../apps/local-engine/src/server.js";
import { LocalPrivateEngine } from "../packages/private-engine/src/index.js";
import { SQLiteFitnessRepository } from "../packages/db/src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "data/fixtures/pacevera-private");
const output = join(root, "docs/pacevera-home-live.js");

const repository = new SQLiteFitnessRepository();
try {
  const handle = createLocalMcpHandler({
    engine: new LocalPrivateEngine({ repository }),
    localEvidenceDir: fixtureDir
  });
  const response = await handle(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "decide_session",
      arguments: {
        date: "2026-07-22",
        scheduledSession: { focus: "Threshold Intervals", type: "run", durationMinutes: 60, intensity: "high" }
      }
    }
  }));
  const payload = JSON.parse(response.result?.content?.[0]?.text || "{}");
  if (payload.todayBrief === undefined) {
    throw new Error("local decision did not return todayBrief");
  }
  await writeFile(
    output,
    `// GENERATED FILE — run npm run generate:home-live to refresh.\n` +
      `globalThis.PACEVERA_TODAY_BRIEF = ${JSON.stringify(payload.todayBrief, null, 2)};\n`
  );
  console.log(`wrote ${output}`);
} finally {
  repository.close();
}
