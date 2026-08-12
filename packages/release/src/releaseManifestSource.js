import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../../../");
export const releaseManifestJson = readFileSync(join(rootDir, "release-manifest.json"), "utf8");
