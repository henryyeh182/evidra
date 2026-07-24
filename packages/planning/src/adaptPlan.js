import { assertValidPlan, assertValidChangeRequest } from "./models.js";

let previewCounter = 0;

function clonePlan(plan) {
  return structuredClone(plan);
}

function selectWeeks(plan, weekIndexes) {
  if (!Array.isArray(weekIndexes) || weekIndexes.length === 0) {
    return plan.weeks;
  }
  const wanted = new Set(weekIndexes);
  return plan.weeks.filter((week) => wanted.has(week.weekIndex));
}

function isAvoided(exerciseName, avoidMovements) {
  const name = exerciseName.toLowerCase();
  return avoidMovements.some((movement) => name.includes(String(movement).toLowerCase()));
}

function matchesRegion(text, bodyRegion) {
  const region = bodyRegion.toLowerCase().replace(/_/g, " ");
  return region.split(" ").some((token) => token.length >= 3 && text.includes(token));
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

function applyAddInjury(plan, changeRequest, diff) {
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
      }

      const remaining = session.exercises.filter(
        (name) => !isAvoided(name, avoidMovements) && !(guardsLowerBody && matchesRegion(name.toLowerCase(), region))
      );
      if (remaining.length !== session.exercises.length) {
        const removed = session.exercises.filter((name) => !remaining.includes(name));
        diff.push({
          weekIndex: week.weekIndex,
          date: session.date,
          field: "exercises",
          before: session.exercises,
          after: remaining.length > 0 ? remaining : ["Bodyweight circuit"],
          reason: `Removed ${removed.join(", ")} due to ${changeRequest.bodyRegion} injury.`
        });
        session.exercises = remaining.length > 0 ? remaining : ["Bodyweight circuit"];
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
  const summary = CHANGE_APPLIERS[changeRequest.kind](resultingPlan, changeRequest, diff);

  previewCounter += 1;
  return {
    previewId: `preview_${plan.id}_${plan.version}_${previewCounter}`,
    planId: plan.id,
    baseVersion: plan.version,
    changeRequest,
    diff,
    resultingPlan,
    summary
  };
}
