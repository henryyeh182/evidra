import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../rule-packages");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const RULE_ID = /^EVD-R-\d{3}$/;
const TIERS = new Set(["base", "domain"]);
const STATUSES = new Set(["draft", "released", "deprecated"]);

function fail(message) {
  throw new Error(`Rule package invariant violated: ${message}`);
}

function version(value, where) {
  if (!SEMVER.test(value || "")) fail(`${where} "${value}" is not semver.`);
  return value.split(".").map(Number);
}

function isCompatible(engineVersion, compatibility) {
  const current = version(engineVersion, "engine version");
  const min = version(compatibility.min, "engineCompatibility.min");
  const max = /^<(.+)$/.exec(compatibility.max || "");
  if (!max) fail("engineCompatibility.max must be a <semver range.");
  const upper = version(max[1], "engineCompatibility.max");
  const compare = (a, b) => a.findIndex((part, i) => part !== b[i]) === -1 ? 0 : a.findIndex((part, i) => part !== b[i]) > -1 && a[a.findIndex((part, i) => part !== b[i])] < b[a.findIndex((part, i) => part !== b[i])] ? -1 : 1;
  return compare(current, min) >= 0 && compare(current, upper) < 0;
}

function packageFiles(packageDir, manifest) {
  const files = [...new Set(manifest.contentFiles || [])].sort();
  return files.map((file) => {
    if (!file || file.startsWith("/") || file.split("/").includes("..")) fail(`content file "${file}" escapes the package.`);
    const absolute = join(packageDir, file);
    const packageRelative = relative(packageDir, absolute).split(sep).join("/");
    if (packageRelative !== file) fail(`content file "${file}" is not a normalized relative path.`);
    try { return { path: file, bytes: readFileSync(absolute) }; }
    catch { fail(`referenced file "${file}" does not exist.`); }
  });
}

function checksum(files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(file.path).update("\0").update(file.bytes).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

export function validateRulePackage(packageDir, { engineVersion = null } = {}) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const expectedPackageId = packageDir.split(sep).at(-1);
  if (!/^[a-z][a-z0-9_]*$/.test(manifest.packageId || "")) fail("packageId is invalid.");
  if (manifest.packageId !== expectedPackageId) fail(`packageId "${manifest.packageId}" does not match directory "${expectedPackageId}".`);
  version(manifest.version, "version");
  version(manifest.schemaVersion, "schemaVersion");
  if (!STATUSES.has(manifest.status)) fail(`status "${manifest.status}" is invalid.`);
  if (!TIERS.has(manifest.tier)) fail(`tier "${manifest.tier}" is invalid.`);
  if (!manifest.engineCompatibility?.min || !manifest.engineCompatibility?.max) fail("engineCompatibility is incomplete.");
  version(manifest.engineCompatibility.min, "engineCompatibility.min");
  version(manifest.engineCompatibility.max.slice(1), "engineCompatibility.max");
  if (engineVersion && !isCompatible(engineVersion, manifest.engineCompatibility)) {
    fail(`package ${manifest.packageId}@${manifest.version} is incompatible with engine ${engineVersion}.`);
  }

  const entries = manifest.rules || [];
  if (manifest.status === "released" && entries.length === 0) fail("a released package must declare rules.");
  const ids = new Set();
  for (const entry of entries) {
    if (!RULE_ID.test(entry.id || "")) fail(`rule id "${entry.id}" is invalid.`);
    if (ids.has(entry.id)) fail(`rule id "${entry.id}" is duplicated.`);
    ids.add(entry.id);
    if (!manifest.contentFiles?.includes(entry.path)) fail(`rule ${entry.id} references an unlisted file.`);
  }

  const files = packageFiles(packageDir, manifest);
  const declaredChecksum = manifest.contentChecksum;
  if (!/^sha256:[0-9a-f]{64}$/.test(declaredChecksum || "")) fail("contentChecksum is not sha256:<64 hex chars>.");
  if (files.length && checksum(files) !== declaredChecksum) fail(`contentChecksum mismatch (expected ${checksum(files)}).`);

  const ruleFiles = new Map();
  for (const file of files.filter(({ path }) => path.endsWith(".json"))) {
    try { ruleFiles.set(file.path, JSON.parse(file.bytes.toString("utf8"))); }
    catch { fail(`referenced JSON file "${file.path}" is invalid JSON.`); }
  }
  const actualIds = new Set();
  for (const entry of entries) {
    const document = ruleFiles.get(entry.path);
    const rules = document?.rules;
    if (!Array.isArray(rules)) fail(`rule file "${entry.path}" does not contain a rules array.`);
    const rule = rules.find((candidate) => candidate.ruleId === entry.id);
    if (!rule) fail(`manifest rule ${entry.id} is not present in "${entry.path}".`);
    if (actualIds.has(rule.ruleId)) fail(`rule id "${rule.ruleId}" occurs more than once across referenced files.`);
    actualIds.add(rule.ruleId);
  }
  if (entries.length !== actualIds.size) fail("manifest rule identity does not match referenced rule content.");
  return Object.freeze({ packageDir, manifest, files, ruleFiles });
}

export function loadBaseRulePackage(options = {}) {
  return validateRulePackage(join(ROOT, "base_rules"), options);
}

export function packageContentChecksum(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return checksum(packageFiles(packageDir, manifest));
}
