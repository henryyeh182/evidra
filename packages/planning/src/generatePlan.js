// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidUserContext } from "../../domain/src/models.js";
import { todayInTimezone } from "../../domain/src/dates.js";
import { computeTrainingLoad } from "../../training-load/src/trainingLoad.js";
import { THRESHOLDS, ENGINE_THRESHOLD_KEYS, buildDecisionBasis } from "../../rules/src/index.js";
import { ENGINE_VERSION } from "../../decision-engine/src/version.js";

// This generator's own thresholds, narrowed to the keys it declared. Same join
// the session engine sits behind: the number lives in the rule that owns it,
// and reading one belonging to another engine yields undefined rather than a
// value from somewhere else.
const RULES = Object.freeze(
  Object.fromEntries(ENGINE_THRESHOLD_KEYS.plan.map((key) => [key, THRESHOLDS[key]]))
);

const UNIVERSAL_EQUIPMENT = new Set(["none", "bodyweight", "outdoor"]);

const WEEK_PHASES = ["base", "build", "peak", "deload"];
const PHASE_MULTIPLIERS = {
  base: 1,
  build: 1.1,
  peak: 1.2,
  deload: 0.65
};

// Load ratios for the first weeks back after a break. A "base" week is base
// relative to a body that has been training; for someone returning from two
// months off it is a step up, not a starting point. The ramp rebuilds toward
// the normal template rather than opening there, and it caps intensity too —
// volume alone would still put a detrained athlete in a tempo session in week
// one. Same return-to-training convention the session engine applies to a
// single day, expressed across weeks.
const RETURN_RAMP = [0.6, 0.75, 0.9];

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Weekly session templates keyed by primary goal type. Each slot is expressed in
 * "ideal" terms; the constraint pass later trims duration, downgrades intensity,
 * and filters exercises to what is actually safe and available.
 *
 * Slots name movements by canonical `exerciseId` only. They used to carry
 * free-text names, which drifted from the catalog the moment the knowledge
 * graph was authored with equipment-qualified names a few hours later: the
 * template's "Bent-over Row" and the graph's "Bent-over Barbell Row" were the
 * same movement that nothing could join. An id either resolves or fails loudly.
 *
 * What varies by prescription rather than by movement — how long, how hard —
 * lives on the slot (`baseMinutes`, `intensity`, `longSession`), never in the
 * movement's identity. A long Zone 2 run is the Zone 2 run movement with a
 * bigger `baseMinutes`, not a separate exercise.
 */
export const GOAL_TEMPLATES = {
  half_marathon: {
    periodizationType: "linear_endurance",
    slots: [
      { dayOffset: 0, focus: "Easy Zone 2 run", type: "run", trainingGoal: "endurance", baseMinutes: 45, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_zone2_run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 1, focus: "Full-body strength support", type: "strength", trainingGoal: "strength", baseMinutes: 45, intensity: "moderate", muscleGroups: ["legs", "glutes", "back", "core"], exercises: [{ exerciseId: "exercise_goblet_squat", equipment: ["dumbbell"] }, { exerciseId: "exercise_romanian_deadlift", equipment: ["barbell"] }] },
      { dayOffset: 2, focus: "Recovery + mobility", type: "mobility", trainingGoal: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs", "core"], exercises: [{ exerciseId: "exercise_lower_body_mobility", equipment: ["none"] }] },
      { dayOffset: 3, focus: "Tempo run", type: "run", trainingGoal: "endurance", baseMinutes: 45, intensity: "high", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_tempo_run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 4, focus: "Upper-body strength", type: "strength", trainingGoal: "strength", baseMinutes: 45, intensity: "moderate", muscleGroups: ["chest", "back", "shoulders", "arms"], exercises: [{ exerciseId: "exercise_dumbbell_bench_press", equipment: ["dumbbell", "bench"] }, { exerciseId: "exercise_bent_over_row", equipment: ["barbell"] }] },
      { dayOffset: 5, focus: "Long run", type: "run", trainingGoal: "endurance", baseMinutes: 75, intensity: "moderate", muscleGroups: ["legs"], longSession: true, exercises: [{ exerciseId: "exercise_zone2_run", equipment: ["treadmill", "outdoor"] }] }
    ]
  },
  build_muscle: {
    periodizationType: "upper_lower_split",
    slots: [
      { dayOffset: 0, focus: "Lower-body strength", type: "strength", trainingGoal: "hypertrophy", baseMinutes: 50, intensity: "high", muscleGroups: ["legs", "glutes", "core"], exercises: [{ exerciseId: "exercise_back_squat", equipment: ["barbell", "squat_rack"] }, { exerciseId: "exercise_romanian_deadlift", equipment: ["barbell"] }] },
      { dayOffset: 1, focus: "Upper-body strength", type: "strength", trainingGoal: "hypertrophy", baseMinutes: 50, intensity: "high", muscleGroups: ["chest", "back", "shoulders", "arms"], exercises: [{ exerciseId: "exercise_dumbbell_bench_press", equipment: ["dumbbell", "bench"] }, { exerciseId: "exercise_bent_over_row", equipment: ["barbell"] }] },
      { dayOffset: 2, focus: "Zone 2 cardio", type: "ride", trainingGoal: "endurance", baseMinutes: 35, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_stationary_bike_z2", equipment: ["stationary_bike"] }] },
      { dayOffset: 3, focus: "Lower-body strength", type: "strength", trainingGoal: "hypertrophy", baseMinutes: 50, intensity: "high", muscleGroups: ["legs", "glutes"], exercises: [{ exerciseId: "exercise_goblet_squat", equipment: ["dumbbell"] }, { exerciseId: "exercise_hip_thrust", equipment: ["barbell", "bench"] }] },
      { dayOffset: 4, focus: "Upper-body strength", type: "strength", trainingGoal: "hypertrophy", baseMinutes: 50, intensity: "high", muscleGroups: ["chest", "back", "arms"], exercises: [{ exerciseId: "exercise_dumbbell_shoulder_press", equipment: ["dumbbell"] }, { exerciseId: "exercise_pullup", equipment: ["pull_up_bar"] }] },
      { dayOffset: 5, focus: "Mobility + core", type: "mobility", trainingGoal: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "core"], exercises: [{ exerciseId: "exercise_lower_body_mobility", equipment: ["none"] }] }
    ]
  },
  general_fitness: {
    periodizationType: "mixed_conditioning",
    slots: [
      { dayOffset: 0, focus: "Full-body strength", type: "strength", trainingGoal: "strength", baseMinutes: 40, intensity: "moderate", muscleGroups: ["legs", "back", "core"], exercises: [{ exerciseId: "exercise_goblet_squat", equipment: ["dumbbell"] }, { exerciseId: "exercise_dumbbell_row", equipment: ["dumbbell", "bench"] }] },
      { dayOffset: 2, focus: "Zone 2 cardio", type: "run", trainingGoal: "endurance", baseMinutes: 35, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_zone2_run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 4, focus: "Full-body strength", type: "strength", trainingGoal: "strength", baseMinutes: 40, intensity: "moderate", muscleGroups: ["chest", "legs", "core"], exercises: [{ exerciseId: "exercise_dumbbell_bench_press", equipment: ["dumbbell", "bench"] }, { exerciseId: "exercise_goblet_squat", equipment: ["dumbbell"] }] },
      { dayOffset: 5, focus: "Mobility + walk", type: "mobility", trainingGoal: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs"], exercises: [{ exerciseId: "exercise_lower_body_mobility", equipment: ["none"] }] }
    ]
  },
  recovery: {
    periodizationType: "recovery_focus",
    slots: [
      { dayOffset: 0, focus: "Recovery walk", type: "walk", trainingGoal: "endurance", baseMinutes: 30, intensity: "low", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_recovery_walk", equipment: ["none", "outdoor"] }] },
      { dayOffset: 2, focus: "Mobility flow", type: "mobility", trainingGoal: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs", "core"], exercises: [{ exerciseId: "exercise_lower_body_mobility", equipment: ["none"] }] },
      { dayOffset: 4, focus: "Easy Zone 2 cardio", type: "ride", trainingGoal: "endurance", baseMinutes: 30, intensity: "low", muscleGroups: ["legs"], exercises: [{ exerciseId: "exercise_stationary_bike_z2", equipment: ["stationary_bike"] }] }
    ]
  }
};

// Last resort when every prescribed movement was filtered out and the catalog
// offers nothing that serves the slot's goal. An id, like everything else here
// — the old free-text "Bodyweight circuit" resolved to nothing.
const FALLBACK_EXERCISE_ID = "exercise_bodyweight_squat";

const GOAL_ALIASES = {
  lose_fat: "general_fitness"
};

function resolveTemplate(goalType) {
  const key = GOAL_ALIASES[goalType] || goalType;
  return GOAL_TEMPLATES[key] || GOAL_TEMPLATES.general_fitness;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function deriveConstraints(context) {
  const schedulePref = context.preferences.find(
    (item) => item.category === "schedule" && item.key === "weekday_available_minutes"
  );
  const weekdayAvailableMinutes = typeof schedulePref?.value === "number" ? schedulePref.value : 30;

  const avoidMovements = context.preferences
    .filter((item) => item.category === "avoid")
    .flatMap((item) => (Array.isArray(item.value) ? item.value : [item.value]))
    .map((value) => String(value));

  const restrictions = context.injuries
    .filter((injury) => injury.status === "active")
    .flatMap((injury) => injury.restrictions);

  const availableEquipment = context.equipment
    .filter((item) => item.available)
    .map((item) => item.type);

  return {
    weekdayAvailableMinutes,
    longSessionMinutes: Math.round(weekdayAvailableMinutes * 1.6),
    availableEquipment,
    restrictions,
    avoidMovements
  };
}

const HIGH_IMPACT_PATTERN = /high-impact|jump|plyo|knee/;

/**
 * The restrictions EVD-R-010 reads, listed rather than reduced to a boolean.
 *
 * The rule reports which strings matched, so the athlete can see that a plan was
 * held back by the word "knee" in something they wrote. Testing each entry
 * separately rather than the joined string is the same test — every alternative
 * in the pattern is a single token, so nothing can match across a join.
 */
function highImpactRestrictions(constraints) {
  return [...constraints.restrictions, ...constraints.avoidMovements].filter((entry) =>
    HIGH_IMPACT_PATTERN.test(String(entry).toLowerCase())
  );
}

function hasHighImpactRestriction(constraints) {
  return highImpactRestrictions(constraints).length >= RULES.highImpactRestrictionPresent;
}

function isEquipmentAvailable(required, availableSet) {
  // A slot's exercise lists acceptable equipment options; it is doable if any
  // option is universal or available.
  return required.some((item) => UNIVERSAL_EQUIPMENT.has(item) || availableSet.has(item));
}

function isAvoided(exerciseName, avoidMovements) {
  const name = exerciseName.toLowerCase();
  return avoidMovements.some((movement) => name.includes(String(movement).toLowerCase()));
}

/**
 * How an exercise id is spoken. The caller injects the catalog-backed one (the
 * MCP server does); on its own this package stays dependency-free and hands
 * back the id, which is the canonical form anyway.
 */
const identityDisplay = (id) => id;

/**
 * Without a catalog to ask, a slot that loses all its movements has nothing to
 * fall back on but the hard-coded id. The MCP server injects the graph-backed
 * one; the package on its own stays dependency-free.
 */
const noCatalog = () => null;

function applyConstraintsToSlot(slot, constraints, availableSet, displayNameFor, findGoalAlternative, trace) {
  const notes = [];
  let intensity = slot.intensity;
  let focus = slot.focus;

  // Safety: downgrade high-impact running when a knee / high-impact restriction is active.
  if (slot.type === "run" && intensity === "high" && hasHighImpactRestriction(constraints)) {
    intensity = "moderate";
    focus = focus.replace(/Tempo run/i, "Controlled Zone 2 run");
    notes.push("Downgraded high-intensity run to protect against active high-impact restriction.");
    trace.sessionsHeldAtModerate += 1;
  }

  const cap = slot.longSession ? constraints.longSessionMinutes : constraints.weekdayAvailableMinutes;

  const exerciseIds = [];
  for (const exercise of slot.exercises) {
    const label = displayNameFor(exercise.exerciseId);
    // The athlete's avoid list is written however they say it ("squat", "rows"),
    // so it is matched against both the spoken name and the id's own slug.
    if (isAvoided(`${label} ${exercise.exerciseId}`, constraints.avoidMovements)) {
      notes.push(`Removed ${label} due to avoid preference.`);
      continue;
    }
    if (!isEquipmentAvailable(exercise.equipment, availableSet)) {
      notes.push(`Skipped ${label} because required equipment is unavailable.`);
      continue;
    }
    exerciseIds.push(exercise.exerciseId);
  }

  if (exerciseIds.length === 0) {
    // The stimulus is what the slot is for. An upper-body strength day whose
    // equipment is missing used to become a bodyweight squat — still a session,
    // but no longer the session the plan prescribed. Ask the catalog for
    // something that serves the same training goal before giving up on it.
    const alternativeResult = findGoalAlternative({
      trainingGoal: slot.trainingGoal,
      availableEquipment: [...availableSet],
      excludeContraindications: constraints.restrictions,
      avoidMovements: constraints.avoidMovements
    });
    const alternative =
      typeof alternativeResult === "string"
        ? alternativeResult
        : alternativeResult?.exerciseId ?? alternativeResult?.id ?? null;
    if (alternativeResult?.excludedByContraindication?.length) {
      trace.contraindicationCandidatesExcluded.push(...alternativeResult.excludedByContraindication);
    }

    if (alternative) {
      exerciseIds.push(alternative);
      notes.push(
        `Substituted ${displayNameFor(alternative)} for the prescribed movements: none were available, and this still trains ${slot.trainingGoal}.`
      );
    } else {
      exerciseIds.push(FALLBACK_EXERCISE_ID);
      notes.push(
        `Fell back to ${displayNameFor(FALLBACK_EXERCISE_ID)} because no prescribed exercise was available and the catalog offers no ${slot.trainingGoal} movement under these constraints.`
      );
    }
  }

  return { focus, intensity, cap, exerciseIds, notes };
}

function buildSession(slot, constraints, availableSet, weekStartDate, phase, multiplier, displayNameFor, findGoalAlternative, trace) {
  const resolved = applyConstraintsToSlot(slot, constraints, availableSet, displayNameFor, findGoalAlternative, trace);
  const targetMinutes = Math.round(slot.baseMinutes * multiplier);
  const durationMinutes = Math.max(15, Math.min(targetMinutes, resolved.cap));
  const date = addDays(weekStartDate, slot.dayOffset);

  const notes = [...resolved.notes];
  let intensity = resolved.intensity;
  if (phase === "return" && intensity === "high") {
    intensity = "moderate";
    notes.push("Held intensity at moderate: this is a return-to-training week after a break.");
  }

  const rationaleParts = [
    `${resolved.focus} scheduled on ${DAY_NAMES[slot.dayOffset]} (${phase} week).`,
    `Duration ${durationMinutes} min after applying ${phase} load factor ${multiplier} and a ${resolved.cap} min availability cap.`
  ];
  rationaleParts.push(...notes);

  return {
    id: `session_${date}_${slot.type}`,
    dayOfWeek: DAY_NAMES[slot.dayOffset],
    date,
    focus: resolved.focus,
    type: slot.type,
    durationMinutes,
    intensity,
    targetMuscleGroups: slot.muscleGroups,
    // Canonical first: `exerciseIds` is what decisions and storage reference,
    // `exercises` is the same list spoken for a human.
    exerciseIds: resolved.exerciseIds,
    exercises: resolved.exerciseIds.map((id) => displayNameFor(id)),
    rationale: rationaleParts.join(" ")
  };
}

function phaseForWeek(weekIndex, totalWeeks, returning = false) {
  // Final week is always a deload; earlier weeks ramp base -> build -> peak,
  // or climb the return ramp first when the plan starts after a break.
  if (weekIndex === totalWeeks - 1) {
    return "deload";
  }
  if (returning && weekIndex < RETURN_RAMP.length) {
    return "return";
  }
  return WEEK_PHASES[Math.min(weekIndex, WEEK_PHASES.length - 2)];
}

/**
 * Generate a deterministic multi-week training plan for a user context.
 *
 * @param {UserFitnessContext} context
 * @param {{ startDate?: string, weeks?: number, goalId?: string, planId?: string, displayNameFor?: Function, findGoalAlternative?: Function }} [options]
 * @returns {import("./models.js").TrainingPlan}
 */
export function generateTrainingPlan(context, options = {}) {
  assertValidUserContext(context);

  // A plan with no start date starts today, where the user lives — not on a
  // date frozen into the source at the time this was written.
  const startDate = options.startDate || todayInTimezone(context.user.timezone);
  const totalWeeks = Math.max(1, options.weeks || 4);
  const constraints = deriveConstraints(context);
  const availableSet = new Set(constraints.availableEquipment);
  const displayNameFor = options.displayNameFor || identityDisplay;
  const findGoalAlternative = options.findGoalAlternative || noCatalog;

  const sortedGoals = [...context.goals].sort((a, b) => a.priority - b.priority);
  const primaryGoal = options.goalId
    ? sortedGoals.find((goal) => goal.id === options.goalId) || sortedGoals[0]
    : sortedGoals[0];
  const goalType = primaryGoal?.type || "general_fitness";
  const template = resolveTemplate(goalType);

  // Training history is a plan input, not just a daily one. Built from the same
  // workout evidence the caller already supplies, so this costs no new data:
  // without it a plan opens at full base load for everyone, and the athlete who
  // has been away for two months gets the identical week to one who trained
  // yesterday. That is the case a plan most needs to get right.
  const { detraining } = computeTrainingLoad(context.workouts, { asOf: startDate });
  const returning = detraining.active;

  // What the injury rule did, counted while it happens rather than inferred
  // from the finished plan: a session at moderate looks the same whether it was
  // held there by a restriction or was written that way in the template.
  const trace = { sessionsHeldAtModerate: 0, contraindicationCandidatesExcluded: [] };

  const weeks = [];
  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const phase = phaseForWeek(weekIndex, totalWeeks, returning);
    const multiplier = phase === "return" ? RETURN_RAMP[weekIndex] : PHASE_MULTIPLIERS[phase];
    const weekStartDate = addDays(startDate, weekIndex * 7);
    const sessions = template.slots.map((slot) =>
      buildSession(slot, constraints, availableSet, weekStartDate, phase, multiplier, displayNameFor, findGoalAlternative, trace)
    );

    weeks.push({
      weekIndex,
      phase,
      startDate: weekStartDate,
      loadMultiplier: multiplier,
      sessions
    });
  }

  const endDate = addDays(startDate, totalWeeks * 7 - 1);

  const reasoning = [
    `Primary goal is ${goalType} (${primaryGoal?.label || "unspecified"}); used the ${template.periodizationType} template.`,
    `Weekly availability cap is ${constraints.weekdayAvailableMinutes} min (long sessions up to ${constraints.longSessionMinutes} min).`,
    `Periodization spans ${totalWeeks} weeks ending with a deload week.`
  ];
  if (returning) {
    reasoning.push(
      `Return to training: last session was ${detraining.daysSinceLastSession} days ago and chronic load is down ${detraining.ctlLossPct}% from its recent peak, so the first ${Math.min(RETURN_RAMP.length, totalWeeks - 1)} week(s) run at reduced load and hold intensity at moderate.`
    );
  }
  // What this sentence used to say was "Active injury constraints applied",
  // which is not what happens: an active injury's restrictions do not remove any
  // prescribed movement from a generated plan. They reach exactly two places —
  // the high-impact check above, and the catalog search that runs only when a
  // slot has already lost every movement it had. Saying "applied" told a reader
  // the plan had been made safe. See EVD-R-010's limitations.
  if (constraints.restrictions.length > 0) {
    const matched = highImpactRestrictions(constraints);
    reasoning.push(
      `Active injury restrictions on file: ${constraints.restrictions.join("; ")}. ` +
        (trace.sessionsHeldAtModerate > 0
          ? `${trace.sessionsHeldAtModerate} high-intensity run(s) were held at moderate on account of ${matched.join("; ")}.`
          : `They did not change any session in this plan: they are read only to hold a high-intensity run at moderate, and to filter a replacement movement when a session has already lost all of its own. They do not remove a prescribed movement.`)
    );
  }
  if (constraints.avoidMovements.length > 0) {
    reasoning.push(`Avoided movements: ${constraints.avoidMovements.join(", ")}.`);
  }

  // The rules that shaped this plan, in the same frame a session decision
  // carries. `fired` is empty on most calls and the frame still travels, saying
  // that no rule applied rather than saying nothing — the distinction a caller
  // cannot otherwise draw between "nothing was contraindicated" and "this path
  // does not check".
  const highImpact = highImpactRestrictions(constraints);
  const fired =
    [
      ...(trace.sessionsHeldAtModerate > 0
        ? [
            {
              ruleId: "EVD-R-010",
              measured: {
                matchedRestrictions: highImpact,
                highImpactRestrictionPresent: highImpact.length,
                sessionsHeldAtModerate: trace.sessionsHeldAtModerate
              }
            }
          ]
        : []),
      ...(trace.contraindicationCandidatesExcluded.length > 0
        ? [
            {
              ruleId: "EVD-R-012",
              measured: {
                contraindicationTagsMatched: trace.contraindicationCandidatesExcluded.length,
                excluded: trace.contraindicationCandidatesExcluded
              }
            }
          ]
        : [])
    ];

  return {
    id: options.planId || `plan_${context.user.id}_${startDate}`,
    userId: context.user.id,
    goalId: primaryGoal?.id || "goal_general_fitness",
    name: `${totalWeeks}-week ${goalType.replace(/_/g, " ")} plan`,
    startDate,
    endDate,
    periodizationType: template.periodizationType,
    status: "planned",
    version: 1,
    constraints,
    weeks,
    reasoning,
    decisionBasis: buildDecisionBasis({ engineVersion: ENGINE_VERSION, fired }),
    createdAt: `${startDate}T00:00:00Z`
  };
}
