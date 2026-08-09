// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidPlan, assertValidChangeRequest } from "./models.js";
import { createHash } from "node:crypto";
import { THRESHOLDS, ENGINE_THRESHOLD_KEYS, buildDecisionBasis } from "../../rules/src/index.js";
import { ENGINE_VERSION } from "../../decision-engine/src/version.js";

// This applier's own thresholds, narrowed to the keys it declared.
const RULES = Object.freeze(
  Object.fromEntries(ENGINE_THRESHOLD_KEYS.planChange.map((key) => [key, THRESHOLDS[key]]))
);

function clonePlan(plan) {
  return structuredClone(plan);
}

function previewFingerprint(plan, changeRequest) {
  return createHash("sha256")
    .update(JSON.stringify({ plan, changeRequest }))
    .digest("hex")
    .slice(0, 16);
}

function selectWeeks(plan, weekIndexes) {
  if (!Array.isArray(weekIndexes) || weekIndexes.length === 0) {
    return plan.weeks;
  }
  const wanted = new Set(weekIndexes);
  return plan.weeks.filter((week) => wanted.has(week.weekIndex));
}

// Sessions are keyed by canonical id, and an injury is described the way the
// athlete says it ("bench press", "overhead"). Slug and prose differ only in
// their separators, so both sides are flattened before comparing — matching the
// id verbatim would miss "bench press" against exercise_dumbbell_bench_press.
function normalizeTerm(text) {
  return String(text).toLowerCase().replace(/^exercise_/, "").replace(/[\s_-]+/g, " ").trim();
}

function isAvoided(exerciseId, avoidMovements) {
  const name = normalizeTerm(exerciseId);
  return avoidMovements.some((movement) => name.includes(normalizeTerm(movement)));
}

const FALLBACK_EXERCISE_ID = "exercise_bodyweight_squat";

/**
 * Keep whatever spelling the session already carried for an id it already had;
 * a newly introduced id has no spoken form here, so it stays canonical until
 * the tool boundary resolves it.
 */
function displayOf(session, id) {
  const ids = session.exerciseIds || session.exercises || [];
  const index = ids.indexOf(id);
  return index >= 0 ? (session.exercises || [])[index] ?? id : id;
}

function matchesRegion(text, bodyRegion) {
  const region = bodyRegion.toLowerCase().replace(/_/g, " ");
  return region
    .split(" ")
    .some((token) => token.length >= RULES.bodyRegionTokenMinLength && text.includes(token));
}

function applyReduceAvailability(plan, changeRequest, diff) {
  const weekdayCap = changeRequest.weekdayAvailableMinutes;
  const longCap = Math.round(weekdayCap * 1.6);
  plan.constraints.weekdayAvailableMinutes = weekdayCap;
  plan.constraints.longSessionMinutes = longCap;

  for (const week of selectWeeks(plan, changeRequest.weekIndexes)) {
    for (const session of week.sessions) {
      const cap = /long/i.test(session.focus) ? longCap : weekdayCap;
      const next = Math.max(15, Math.min(session.durationMinutes, cap));
      if (next !== session.durationMinutes) {
        diff.push({
          weekIndex: week.weekIndex,
          date: session.date,
          field: "durationMinutes",
          before: session.durationMinutes,
          after: next,
          reason: changeRequest.reason || `Reduced availability to ${weekdayCap} min/day.`
        });
        session.rationale += ` Trimmed to ${next} min after availability dropped to ${weekdayCap} min/day.`;
        session.durationMinutes = next;
      }
    }
  }

  return `Reduced weekday availability to ${weekdayCap} min and re-capped ${diff.length} session(s).`;
}

function applyAddInjury(plan, changeRequest, diff, trace) {
  const restrictions = changeRequest.restrictions || [`protect ${changeRequest.bodyRegion}`];
  const avoidMovements = changeRequest.avoidMovements || [];
  plan.constraints.restrictions = [...new Set([...plan.constraints.restrictions, ...restrictions])];
  plan.constraints.avoidMovements = [...new Set([...plan.constraints.avoidMovements, ...avoidMovements])];

  const region = changeRequest.bodyRegion.toLowerCase();
  const guardsLowerBody = /knee|ankle|hip|leg|foot/.test(region);

  for (const week of plan.weeks) {
    for (const session of week.sessions) {
      // Downgrade high-intensity running / high-impact lower-body work.
      if (session.intensity === "high" && (session.type === "run" || guardsLowerBody)) {
        diff.push({
          weekIndex: week.weekIndex,
          date: session.date,
          field: "intensity",
          before: session.intensity,
          after: "moderate",
          reason: changeRequest.reason || `New ${changeRequest.bodyRegion} injury; reduced load.`
        });
        session.intensity = "moderate";
        session.rationale += ` Intensity lowered to protect ${changeRequest.bodyRegion}.`;
        trace.intensityReductions += 1;
        trace.sessionsAffected.add(session.date);
      }

      const currentIds = session.exerciseIds || session.exercises || [];
      const remaining = currentIds.filter(
        (id) => !isAvoided(id, avoidMovements) && !(guardsLowerBody && matchesRegion(normalizeTerm(id), region))
      );
      if (remaining.length !== currentIds.length) {
        const removed = currentIds.filter((id) => !remaining.includes(id));
        const after = remaining.length > 0 ? remaining : [FALLBACK_EXERCISE_ID];
        diff.push({
          weekIndex: week.weekIndex,
          date: session.date,
          field: "exercises",
          before: currentIds,
          after,
          reason: `Removed ${removed.join(", ")} due to ${changeRequest.bodyRegion} injury.`
        });
        session.exerciseIds = after;
        // The spoken list is derived, so it cannot drift from the canonical one.
        // Names are re-resolved at the tool boundary; here they track the ids.
        session.exercises = after.map((id) => displayOf(session, id));
        for (const id of removed) trace.movementsRemoved.add(id);
        trace.sessionsAffected.add(session.date);
      }
    }
  }

  return `Applied ${changeRequest.bodyRegion} injury constraints across the plan (${diff.length} change(s)).`;
}

function applyDeloadWeek(plan, changeRequest, diff) {
  const week = plan.weeks.find((item) => item.weekIndex === changeRequest.weekIndex);
  if (!week) {
    throw new Error(`Week ${changeRequest.weekIndex} does not exist in this plan.`);
  }

  const factor = 0.6;
  week.phase = "deload";
  week.loadMultiplier = Number((week.loadMultiplier * factor).toFixed(2));

  for (const session of week.sessions) {
    const next = Math.max(15, Math.round(session.durationMinutes * factor));
    if (next !== session.durationMinutes) {
      diff.push({
        weekIndex: week.weekIndex,
        date: session.date,
        field: "durationMinutes",
        before: session.durationMinutes,
        after: next,
        reason: changeRequest.reason || `Deload week ${changeRequest.weekIndex}.`
      });
      session.rationale += ` Volume cut for deload week ${changeRequest.weekIndex}.`;
      session.durationMinutes = next;
    }
    if (session.intensity === "high") {
      session.intensity = "moderate";
    }
  }

  return `Converted week ${changeRequest.weekIndex} into a deload week (${diff.length} session change(s)).`;
}

const CHANGE_APPLIERS = {
  reduce_availability: applyReduceAvailability,
  add_injury: applyAddInjury,
  deload_week: applyDeloadWeek
};

/**
 * Produce a non-destructive preview of applying a change request to a plan.
 *
 * @param {import("./models.js").TrainingPlan} plan
 * @param {import("./models.js").PlanChangeRequest} changeRequest
 * @returns {import("./models.js").PlanChangePreview}
 */
export function previewPlanChange(plan, changeRequest) {
  assertValidPlan(plan);
  assertValidChangeRequest(changeRequest);

  const resultingPlan = clonePlan(plan);
  resultingPlan.status = "modified";
  const diff = [];
  const trace = { sessionsAffected: new Set(), intensityReductions: 0, movementsRemoved: new Set() };
  const summary = CHANGE_APPLIERS[changeRequest.kind](resultingPlan, changeRequest, diff, trace);

  // The rule that governed the change, where one did. Only `add_injury` can
  // fire an injury rule; a deload or an availability cut is not a safety
  // decision and says so by carrying a frame with nothing in it.
  //
  // The clone inherits whatever `decisionBasis` the plan was generated with,
  // which describes how the plan was built and not what this change did. Two
  // different questions, so the preview answers its own at its own level and
  // leaves the plan's alone.
  const fired =
    trace.sessionsAffected.size >= RULES.injuryAffectedSessionsPresent && changeRequest.kind === "add_injury"
      ? [
          {
            ruleId: "EVD-R-011",
            measured: {
              bodyRegion: changeRequest.bodyRegion,
              injuryAffectedSessionsPresent: trace.sessionsAffected.size,
              intensityReductions: trace.intensityReductions,
              movementsRemoved: [...trace.movementsRemoved]
            }
          }
        ]
      : [];

  return {
    decisionBasis: buildDecisionBasis({ engineVersion: ENGINE_VERSION, fired }),
    // Deterministic: retries and separate stateless server instances return
    // the same identifier for the same input, without a process counter.
    previewId: `preview_${plan.id}_${plan.version}_${previewFingerprint(plan, changeRequest)}`,
    planId: plan.id,
    baseVersion: plan.version,
    changeRequest,
    diff,
    resultingPlan,
    summary
  };
}
