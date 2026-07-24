import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, "../../schemas/tools");

/**
 * Load a tool contract schema from /schemas.
 *
 * @param {string} toolName
 * @param {"input" | "output"} kind
 * @returns {Promise<object>}
 */
export async function loadContract(toolName, kind) {
  const raw = await readFile(join(schemasDir, `${toolName}.${kind}.json`), "utf8");
  return JSON.parse(raw);
}
