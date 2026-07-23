import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSemanticFitnessState } from "../packages/semantic-engine/src/generateSemanticFitnessState.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function readJson(relativePath) {
  const raw = await readFile(join(rootDir, relativePath), "utf8");
  return JSON.parse(raw);
}

const userContext = await readJson("data/seeds/sample-user-context.json");
const state = generateSemanticFitnessState(userContext, {
  date: "2026-07-23",
  timezone: "Asia/Taipei"
});

console.log(JSON.stringify(state, null, 2));
