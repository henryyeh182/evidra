// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Bridges Evidence Flow's local connectors (packages/connectors/src/local/)
// into the tool call a caller makes. The hosted tools already accept
// `evidence` as an ordinary argument — this only fills that argument in when
// the caller omitted it and a local export folder is present, so the shipped
// `.mcpb` can answer "should I still do today's session" from the user's own
// exported data instead of requiring them to retype it every time. A caller
// that DOES supply `evidence` is never overridden.
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { assembleLocalEvidence } from "../../../packages/connectors/src/local/assembleLocalEvidence.js";
import { resolveToolName } from "../../mcp-server/src/toolDefinitions.js";

export const DEFAULT_PRIVATE_DIR = join(homedir(), "Pacevera");

/**
 * Claude Desktop may leave an unexpanded manifest placeholder in the env
 * value. Never pass that literal (or a cwd-relative path) to the connectors.
 */
export function normalizePrivateDir(value) {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_PRIVATE_DIR;
  const candidate = value.trim();
  if (/\$\{[^}]+\}/.test(candidate) || !isAbsolute(candidate)) return DEFAULT_PRIVATE_DIR;
  return candidate;
}

/** 90 days matches the window packages/connectors already uses for Garmin
 * (eval/scenarios/run.js: `buildGarminEvidence(rawExport, { sinceDays: 90 })`)
 * and comfortably covers training-load's 42-day chronic time constant
 * (packages/training-load/src/trainingLoad.js). This filter only bounds
 * payload size and call latency for someone with years of exported history —
 * it does not affect which signals count as fresh; that is
 * signalCoverage's staleness windows, applied downstream. */
const DEFAULT_SINCE_DAYS = 90;

/** The tools whose input schema accepts `evidence` and therefore benefit from
 * this fill-in. decide_exercise_substitution has no evidence field. */
const EVIDENCE_TOOLS = new Set([
  "evidra_assess_fitness_state",
  "evidra_decide_session",
  "evidra_generate_plan",
  "evidra_generate_workout"
]);

export function callAcceptsLocalEvidence(toolName) {
  return EVIDENCE_TOOLS.has(resolveToolName(toolName));
}

/** True when the caller already supplied at least one data point — an
 * explicit override this module must never replace, even a single entry. */
export function hasUsableEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return ["workouts", "healthMetrics", "vendorAssessments"].some(
    (field) => Array.isArray(evidence[field]) && evidence[field].length > 0
  );
}

/**
 * Local connector output is a "user context" (workouts/healthMetrics/vendorAssessments
 * with ids and sourceRecordIds); the `evidence` a tool call takes is a
 * narrower, caller-facing shape (packages/evidence/src/model.js's
 * evidenceToUserContext defines exactly what it reads). The field names that
 * matter already agree — this only renames `user` to `profile` and drops the
 * fields evidenceToUserContext does not look at, plus bounds the date range.
 */
export function contextToEvidence(context, { sinceDays = DEFAULT_SINCE_DAYS, asOf } = {}) {
  const cutoffMs = (asOf ? new Date(asOf).getTime() : Date.now()) - sinceDays * 24 * 60 * 60 * 1000;
  const inWindow = (iso) => {
    const time = new Date(iso).getTime();
    return Number.isFinite(time) && time >= cutoffMs;
  };

  return {
    profile: {
      timezone: context.user?.timezone,
      fitnessLevel: context.user?.fitnessLevel
    },
    goals: context.goals || [],
    constraints: {
      injuries: context.injuries || [],
      equipment: context.equipment || []
    },
    workouts: (context.workouts || []).filter((w) => inWindow(w.startedAt)),
    healthMetrics: (context.healthMetrics || []).filter((m) => inWindow(m.recordedAt)),
    vendorAssessments: (context.vendorAssessments || []).filter((v) => inWindow(v.recordedAt))
  };
}

/**
 * Scans `baseDir` for whatever local exports exist and returns an `evidence`
 * object ready to pass as a tool argument, or `null` when nothing was found —
 * the caller falls through to the tool's normal "evidence required" response
 * rather than this silently deciding on nothing. There is no stored identity
 * here (no `data/private/my-user-context.json` in an installed extension);
 * the timezone comes from the machine the extension is running on, which is
 * the same machine the export folder lives on.
 */
export async function loadLocalEvidence({ baseDir = DEFAULT_PRIVATE_DIR, sinceDays, asOf } = {}) {
  const baseContext = {
    user: { id: "local_user", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    goals: [],
    preferences: [],
    injuries: [],
    equipment: [],
    workouts: [],
    healthMetrics: [],
    vendorAssessments: []
  };

  const { context, sources } = await assembleLocalEvidence({ baseDir, context: baseContext });
  const anyPresent = Object.values(sources).some((info) => info.status === "present");
  if (!anyPresent) return { evidence: null, sources };

  return { evidence: contextToEvidence(context, { sinceDays, asOf }), sources };
}
