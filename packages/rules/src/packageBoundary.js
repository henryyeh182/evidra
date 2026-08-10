import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../rule-packages");
const MANIFEST_SCHEMA = JSON.parse(readFileSync(join(ROOT, "schemas/rule-package.schema.json"), "utf8"));
const EVIDENCE_PACKET_SCHEMA = JSON.parse(readFileSync(join(ROOT, "schemas/evidence-packet.schema.json"), "utf8"));
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const RULE_ID = /^EVD-R-\d{3}$/;
const TIERS = new Set(["base", "domain"]);
const STATUSES = new Set(["draft", "released", "deprecated"]);

function fail(message) {
  throw new Error(`Rule package invariant violated: ${message}`);
}

function schemaType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// The repository intentionally has no runtime dependency on a JSON Schema
// package. This small validator implements the vocabulary used by the package
// manifest schema, so the schema file is executable rather than documentary.
function validateSchema(value, schema, path = "$") {
  if (schema.type && ![].concat(schema.type).includes(schemaType(value))) {
    fail(`${path} must be ${[].concat(schema.type).join(" or ")}.`);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    fail(`${path} must be one of ${schema.enum.join(", ")}.`);
  }
  if (schema.pattern && (typeof value !== "string" || !new RegExp(schema.pattern).test(value))) {
    fail(`${path} does not match the manifest schema pattern.`);
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${path} is too short.`);
  if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${path} must contain at least ${schema.minItems} item(s).`);
  if (schema.uniqueItems) {
    const serialized = value.map((item) => JSON.stringify(item));
    if (new Set(serialized).size !== serialized.length) fail(`${path} must contain unique items.`);
  }
  if (schema.required) {
    for (const key of schema.required) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${path}.${key} is required by the manifest schema.`);
  }
  if (schema.properties) {
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) fail(`${path}.${key} is not allowed by the manifest schema.`);
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateSchema(value[key], child, `${path}.${key}`);
    }
  }
  if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
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

export function validateRulePackage(packageDir, { engineVersion = null, expectedPackageId = null } = {}) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  validateSchema(manifest, MANIFEST_SCHEMA);
  const directoryPackageId = expectedPackageId || packageDir.split(sep).at(-1);
  if (!/^[a-z][a-z0-9_]*$/.test(manifest.packageId || "")) fail("packageId is invalid.");
  if (manifest.packageId !== directoryPackageId) fail(`packageId "${manifest.packageId}" does not match directory "${directoryPackageId}".`);
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
  if (manifest.status === "released" && (!manifest.reviewRecord || !existsSync(join(packageDir, manifest.reviewRecord)))) {
    fail("a released package must point to an existing reviewRecord.");
  }
  if (manifest.status === "released" && manifest.contentFiles.length === 0) fail("a released package must declare contentFiles.");
  const ids = new Set();
  for (const entry of entries) {
    if (!RULE_ID.test(entry.id || "")) fail(`rule id "${entry.id}" is invalid.`);
    if (ids.has(entry.id)) fail(`rule id "${entry.id}" is duplicated.`);
    ids.add(entry.id);
    if (!manifest.contentFiles?.includes(entry.path)) fail(`rule ${entry.id} references an unlisted file.`);
  }

  for (const packetPath of manifest.evidencePackets || []) {
    if (!manifest.contentFiles.includes(packetPath)) fail(`evidence packet "${packetPath}" is not listed as a content file.`);
    const packetFile = packageFiles(packageDir, { contentFiles: [packetPath] })[0];
    let packet;
    try { packet = JSON.parse(packetFile.bytes.toString("utf8")); }
    catch { fail(`evidence packet "${packetPath}" is invalid JSON.`); }
    validateSchema(packet, EVIDENCE_PACKET_SCHEMA, packetPath);
    for (const ruleId of packet.applicable_rule_ids) {
      if (!ids.has(ruleId)) fail(`evidence packet "${packetPath}" references unknown rule "${ruleId}".`);
    }
  }

  const files = packageFiles(packageDir, manifest);
  const declaredChecksum = manifest.contentChecksum;
  if (!/^sha256:[0-9a-f]{64}$/.test(declaredChecksum || "")) fail("contentChecksum is not sha256:<64 hex chars>.");
  if (!files.length && declaredChecksum !== "sha256:" + "0".repeat(64)) fail("an empty draft package must use the zero contentChecksum.");
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

export function loadRulePackage(packageDir, options = {}) {
  return validateRulePackage(packageDir, options);
}

export function loadBaseRulePackage(options = {}) {
  return loadRulePackage(join(ROOT, "base_rules"), options);
}

export function packageContentChecksum(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return checksum(packageFiles(packageDir, manifest));
}
