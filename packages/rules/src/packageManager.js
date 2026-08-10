import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ENGINE_VERSION } from "../../decision-engine/src/version.js";
import { validateRulePackage } from "./packageBoundary.js";

const ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;

function fail(message) {
  throw new Error(`Rule package manager: ${message}`);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function paths(storeDir, packageId, version) {
  return {
    packageDir: join(storeDir, "packages", packageId, version),
    pointerFile: join(storeDir, "active.json"),
    historyFile: join(storeDir, "active-history.json")
  };
}

async function readOptional(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

function packageSummary(loaded) {
  return {
    packageId: loaded.manifest.packageId,
    version: loaded.manifest.version,
    status: loaded.manifest.status,
    tier: loaded.manifest.tier,
    contentChecksum: loaded.manifest.contentChecksum,
    engineCompatibility: loaded.manifest.engineCompatibility,
    ruleIds: loaded.manifest.rules.map(({ id }) => id),
    reviewRecord: loaded.manifest.reviewRecord || null
  };
}

export function packageStorePaths(storeDir, packageId, version) {
  return paths(resolve(storeDir), packageId, version);
}

export function validateCandidate(packageDir, { engineVersion = ENGINE_VERSION } = {}) {
  const loaded = validateRulePackage(resolve(packageDir), { engineVersion });
  if (loaded.manifest.status !== "released") fail("only released packages can be installed.");
  return packageSummary(loaded);
}

export async function readActive(storeDir) {
  return readOptional(join(resolve(storeDir), "active.json"), null);
}

export async function readActiveHistory(storeDir) {
  return readOptional(join(resolve(storeDir), "active-history.json"), []);
}

export async function commitInstall({ storeDir, sourceDir, candidate, verification }) {
  if (!verification || verification.findings || verification.errors || !Number.isInteger(verification.scenarios) || verification.scenarios < 1) {
    fail("install requires a successful Decision Harness verification.");
  }
  const root = resolve(storeDir);
  const source = resolve(sourceDir);
  const destination = paths(root, candidate.packageId, candidate.version).packageDir;
  const current = await readActive(root);
  const history = await readActiveHistory(root);

  if (current && current.packageId === candidate.packageId && current.version === candidate.version &&
      current.contentChecksum !== candidate.contentChecksum) {
    fail("the version already has a different checksum; immutable versions cannot be overwritten.");
  }

  await mkdir(dirname(destination), { recursive: true });
  if (!existsSync(destination)) {
    await cp(source, destination, { recursive: true, errorOnExist: true });
  } else {
    const installed = validateRulePackage(destination, { engineVersion: ENGINE_VERSION, expectedPackageId: candidate.packageId });
    if (installed.manifest.contentChecksum !== candidate.contentChecksum) {
      fail("the installed immutable version has a different checksum.");
    }
  }

  const next = {
    ...candidate,
    activeAt: new Date().toISOString(),
    verification
  };
  if (current && (current.packageId !== next.packageId || current.version !== next.version || current.contentChecksum !== next.contentChecksum)) {
    history.push(current);
  }
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "active-history.json"), json(history));
  await writeFile(join(root, "active.json"), json(next));
  return next;
}

export async function rollbackPackage(storeDir, packageId, { engineVersion = ENGINE_VERSION } = {}) {
  const root = resolve(storeDir);
  const current = await readActive(root);
  if (!current) fail("no active package exists.");
  if (packageId && current.packageId !== packageId) fail(`active package is ${current.packageId}, not ${packageId}.`);

  const history = await readActiveHistory(root);
  const index = [...history].reverse().findIndex((item) => item.packageId === current.packageId);
  if (index === -1) fail("no rollback target exists for the active package.");
  const target = history[history.length - 1 - index];
  const targetDir = paths(root, target.packageId, target.version).packageDir;
  const loaded = validateRulePackage(targetDir, { engineVersion, expectedPackageId: target.packageId });
  if (loaded.manifest.contentChecksum !== target.contentChecksum) fail("rollback target checksum no longer matches its pointer.");

  history.splice(history.length - 1 - index, 1);
  history.push(current);
  const next = { ...target, activeAt: new Date().toISOString(), rollbackFrom: current.version };
  await writeFile(join(root, "active-history.json"), json(history));
  await writeFile(join(root, "active.json"), json(next));
  return next;
}

export { ZERO_CHECKSUM };
