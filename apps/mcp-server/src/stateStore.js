// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * A deliberately small, dependency-free durable record for cross-host
 * continuity. The MCP transport is stateless; the athlete record is not.
 *
 * Identity is supplied by the authenticated MCP caller (normally OAuth `sub`)
 * or by an explicit userId in local development. Anonymous requests never
 * reach this store, so two unrelated model conversations cannot be merged.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { rootDir } from "./rootDir.js";

const DEFAULT_DIR = join(rootDir, "data", "private", "athletes");
const writeLocks = new Map();

// Continuity is user-controlled storage, not a hosted retention service.
export const CONTINUITY_RETENTION = "until_explicit_delete";

function keyFor(identity) {
  return createHash("sha256").update(String(identity)).digest("hex");
}

function recordPath(identity, directory) {
  return join(directory, `${keyFor(identity)}.json`);
}

function stableKey(value, fields) {
  return fields.map((field) => value?.[field] ?? "").join("|");
}

function mergeUnique(existing = [], incoming = [], fields) {
  const byKey = new Map(existing.map((item) => [stableKey(item, fields), item]));
  for (const item of incoming) byKey.set(stableKey(item, fields), item);
  return [...byKey.values()];
}

function mergeContext(existing, incoming) {
  const current = existing || {};
  return {
    ...current,
    ...incoming,
    user: { ...(current.user || {}), ...(incoming.user || {}) },
    goals: incoming.goals?.length ? incoming.goals : current.goals || [],
    preferences: mergeUnique(current.preferences, incoming.preferences, ["category", "key"]),
    injuries: mergeUnique(current.injuries, incoming.injuries, ["id", "bodyRegion", "status"]),
    equipment: mergeUnique(current.equipment, incoming.equipment, ["type", "location"]),
    workouts: mergeUnique(current.workouts, incoming.workouts, ["id", "startedAt", "durationMinutes", "source"]),
    healthMetrics: mergeUnique(current.healthMetrics, incoming.healthMetrics, ["type", "recordedAt", "source"]),
    vendorAssessments: mergeUnique(
      current.vendorAssessments,
      incoming.vendorAssessments,
      ["type", "recordedAt", "source"]
    )
  };
}

async function readRecord(identity, directory) {
  try {
    return JSON.parse(await readFile(recordPath(identity, directory), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeRecord(identity, context, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = recordPath(identity, directory);
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ updatedAt: new Date().toISOString(), context })}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, destination);
}

export function stateDirectory(options = {}) {
  return options.directory || process.env.EVIDRA_STATE_DIR || DEFAULT_DIR;
}

export async function loadAthleteContext(identity, options = {}) {
  if (!identity) return null;
  const record = await readRecord(identity, stateDirectory(options));
  return record?.context || null;
}

export async function exportAthleteRecord(identity, options = {}) {
  if (!identity) return null;
  return readRecord(identity, stateDirectory(options));
}

/** Delete exactly one hashed-identity record; never scan or delete a directory. */
export async function deleteAthleteRecord(identity, options = {}) {
  if (!identity) return false;
  const destination = recordPath(identity, stateDirectory(options));
  try {
    await unlink(destination);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function mergeAthleteEvidence(identity, context, options = {}) {
  if (!identity) return context;
  const directory = stateDirectory(options);
  const lockKey = `${directory}:${keyFor(identity)}`;
  const previous = writeLocks.get(lockKey) || Promise.resolve();
  let release;
  const currentWrite = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => currentWrite);
  writeLocks.set(lockKey, queued);
  await previous;
  try {
    const current = await readRecord(identity, directory);
    const merged = mergeContext(current?.context, context);
    await writeRecord(identity, merged, directory);
    return merged;
  } finally {
    release();
    if (writeLocks.get(lockKey) === queued) writeLocks.delete(lockKey);
  }
}
