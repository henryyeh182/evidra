import { assertValidUserContext } from "../../domain/src/models.js";

const UNIVERSAL_EQUIPMENT = new Set(["none", "bodyweight", "outdoor"]);

const WEEK_PHASES = ["base", "build", "peak", "deload"];
const PHASE_MULTIPLIERS = {
  base: 1,
  build: 1.1,
  peak: 1.2,
  deload: 0.65
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Weekly session templates keyed by primary goal type. Each slot is expressed in
 * "ideal" terms; the constraint pass later trims duration, downgrades intensity,
 * and filters exercises to what is actually safe and available.
 */
const GOAL_TEMPLATES = {
  half_marathon: {
    periodizationType: "linear_endurance",
    slots: [
      { dayOffset: 0, focus: "Easy Zone 2 run", type: "run", baseMinutes: 45, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ name: "Zone 2 Run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 1, focus: "Full-body strength support", type: "strength", baseMinutes: 45, intensity: "moderate", muscleGroups: ["legs", "glutes", "back", "core"], exercises: [{ name: "Goblet Squat", equipment: ["dumbbell"] }, { name: "Romanian Deadlift", equipment: ["barbell"] }] },
      { dayOffset: 2, focus: "Recovery + mobility", type: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs", "core"], exercises: [{ name: "Lower Body Mobility Flow", equipment: ["none"] }] },
      { dayOffset: 3, focus: "Tempo run", type: "run", baseMinutes: 45, intensity: "high", muscleGroups: ["legs"], exercises: [{ name: "Tempo Run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 4, focus: "Upper-body strength", type: "strength", baseMinutes: 45, intensity: "moderate", muscleGroups: ["chest", "back", "shoulders", "arms"], exercises: [{ name: "Dumbbell Bench Press", equipment: ["dumbbell"] }, { name: "Bent-over Row", equipment: ["barbell"] }] },
      { dayOffset: 5, focus: "Long run", type: "run", baseMinutes: 75, intensity: "moderate", muscleGroups: ["legs"], longSession: true, exercises: [{ name: "Long Zone 2 Run", equipment: ["treadmill", "outdoor"] }] }
    ]
  },
  build_muscle: {
    periodizationType: "upper_lower_split",
    slots: [
      { dayOffset: 0, focus: "Lower-body strength", type: "strength", baseMinutes: 50, intensity: "high", muscleGroups: ["legs", "glutes", "core"], exercises: [{ name: "Back Squat", equipment: ["barbell"] }, { name: "Romanian Deadlift", equipment: ["barbell"] }] },
      { dayOffset: 1, focus: "Upper-body strength", type: "strength", baseMinutes: 50, intensity: "high", muscleGroups: ["chest", "back", "shoulders", "arms"], exercises: [{ name: "Dumbbell Bench Press", equipment: ["dumbbell"] }, { name: "Bent-over Row", equipment: ["barbell"] }] },
      { dayOffset: 2, focus: "Zone 2 cardio", type: "ride", baseMinutes: 35, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ name: "Recovery Ride", equipment: ["stationary_bike", "outdoor"] }] },
      { dayOffset: 3, focus: "Lower-body strength", type: "strength", baseMinutes: 50, intensity: "high", muscleGroups: ["legs", "glutes"], exercises: [{ name: "Goblet Squat", equipment: ["dumbbell"] }, { name: "Hip Thrust", equipment: ["barbell"] }] },
      { dayOffset: 4, focus: "Upper-body strength", type: "strength", baseMinutes: 50, intensity: "high", muscleGroups: ["chest", "back", "arms"], exercises: [{ name: "Overhead Press", equipment: ["dumbbell"] }, { name: "Pull-up", equipment: ["pull_up_bar"] }] },
      { dayOffset: 5, focus: "Mobility + core", type: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "core"], exercises: [{ name: "Lower Body Mobility Flow", equipment: ["none"] }] }
    ]
  },
  general_fitness: {
    periodizationType: "mixed_conditioning",
    slots: [
      { dayOffset: 0, focus: "Full-body strength", type: "strength", baseMinutes: 40, intensity: "moderate", muscleGroups: ["legs", "back", "core"], exercises: [{ name: "Goblet Squat", equipment: ["dumbbell"] }, { name: "Bent-over Row", equipment: ["dumbbell"] }] },
      { dayOffset: 2, focus: "Zone 2 cardio", type: "run", baseMinutes: 35, intensity: "moderate", muscleGroups: ["legs"], exercises: [{ name: "Zone 2 Run", equipment: ["treadmill", "outdoor"] }] },
      { dayOffset: 4, focus: "Full-body strength", type: "strength", baseMinutes: 40, intensity: "moderate", muscleGroups: ["chest", "legs", "core"], exercises: [{ name: "Dumbbell Bench Press", equipment: ["dumbbell"] }, { name: "Goblet Squat", equipment: ["dumbbell"] }] },
      { dayOffset: 5, focus: "Mobility + walk", type: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs"], exercises: [{ name: "Lower Body Mobility Flow", equipment: ["none"] }] }
    ]
  },
  recovery: {
    periodizationType: "recovery_focus",
    slots: [
      { dayOffset: 0, focus: "Recovery walk", type: "walk", baseMinutes: 30, intensity: "low", muscleGroups: ["legs"], exercises: [{ name: "Recovery Walk", equipment: ["outdoor", "treadmill"] }] },
      { dayOffset: 2, focus: "Mobility flow", type: "mobility", baseMinutes: 30, intensity: "low", muscleGroups: ["hips", "legs", "core"], exercises: [{ name: "Lower Body Mobility Flow", equipment: ["none"] }] },
      { dayOffset: 4, focus: "Easy Zone 2 cardio", type: "ride", baseMinutes: 30, intensity: "low", muscleGroups: ["legs"], exercises: [{ name: "Recovery Ride", equipment: ["stationary_bike", "outdoor"] }] }
    ]
  }
};

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

function hasHighImpactRestriction(constraints) {
  const haystack = [...constraints.restrictions, ...constraints.avoidMovements].join(" ").toLowerCase();
  return /high-impact|jump|plyo|knee/.test(haystack);
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

function applyConstraintsToSlot(slot, constraints, availableSet) {
  const notes = [];
  let intensity = slot.intensity;
  let focus = slot.focus;

  // Safety: downgrade high-impact running when a knee / high-impact restriction is active.
  if (slot.type === "run" && intensity === "high" && hasHighImpactRestriction(constraints)) {
    intensity = "moderate";
    focus = focus.replace(/Tempo run/i, "Controlled Zone 2 run");
    notes.push("Downgraded high-intensity run to protect against active high-impact restriction.");
  }

  const cap = slot.longSession ? constraints.longSessionMinutes : constraints.weekdayAvailableMinutes;

  const exercises = [];
  for (const exercise of slot.exercises) {
    if (isAvoided(exercise.name, constraints.avoidMovements)) {
      notes.push(`Removed ${exercise.name} due to avoid preference.`);
      continue;
    }
    if (!isEquipmentAvailable(exercise.equipment, availableSet)) {
      notes.push(`Skipped ${exercise.name} because required equipment is unavailable.`);
      continue;
    }
    exercises.push(exercise.name);
  }

  if (exercises.length === 0) {
    exercises.push("Bodyweight circuit");
    notes.push("Fell back to a bodyweight circuit because no prescribed exercise was available.");
  }

  return { focus, intensity, cap, exercises, notes };
}

function buildSession(slot, constraints, availableSet, weekStartDate, phase, multiplier) {
  const resolved = applyConstraintsToSlot(slot, constraints, availableSet);
  const targetMinutes = Math.round(slot.baseMinutes * multiplier);
  const durationMinutes = Math.max(15, Math.min(targetMinutes, resolved.cap));
  const date = addDays(weekStartDate, slot.dayOffset);

  const rationaleParts = [
    `${resolved.focus} scheduled on ${DAY_NAMES[slot.dayOffset]} (${phase} week).`,
    `Duration ${durationMinutes} min after applying ${phase} load factor ${multiplier} and a ${resolved.cap} min availability cap.`
  ];
  rationaleParts.push(...resolved.notes);

  return {
    id: `session_${date}_${slot.type}`,
    dayOfWeek: DAY_NAMES[slot.dayOffset],
    date,
    focus: resolved.focus,
    type: slot.type,
    durationMinutes,
    intensity: resolved.intensity,
    targetMuscleGroups: slot.muscleGroups,
    exercises: resolved.exercises,
    rationale: rationaleParts.join(" ")
  };
}

function phaseForWeek(weekIndex, totalWeeks) {
  // Final week is always a deload; earlier weeks ramp base -> build -> peak.
  if (weekIndex === totalWeeks - 1) {
    return "deload";
  }
  return WEEK_PHASES[Math.min(weekIndex, WEEK_PHASES.length - 2)];
}

/**
 * Generate a deterministic multi-week training plan for a user context.
 *
 * @param {UserFitnessContext} context
 * @param {{ startDate?: string, weeks?: number, goalId?: string, planId?: string }} [options]
 * @returns {import("./models.js").TrainingPlan}
 */
export function generateTrainingPlan(context, options = {}) {
  assertValidUserContext(context);

  const startDate = options.startDate || "2026-07-27";
  const totalWeeks = Math.max(1, options.weeks || 4);
  const constraints = deriveConstraints(context);
  const availableSet = new Set(constraints.availableEquipment);

  const sortedGoals = [...context.goals].sort((a, b) => a.priority - b.priority);
  const primaryGoal = options.goalId
    ? sortedGoals.find((goal) => goal.id === options.goalId) || sortedGoals[0]
    : sortedGoals[0];
  const goalType = primaryGoal?.type || "general_fitness";
  const template = resolveTemplate(goalType);

  const weeks = [];
  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const phase = phaseForWeek(weekIndex, totalWeeks);
    const multiplier = PHASE_MULTIPLIERS[phase];
    const weekStartDate = addDays(startDate, weekIndex * 7);
    const sessions = template.slots.map((slot) =>
      buildSession(slot, constraints, availableSet, weekStartDate, phase, multiplier)
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
  if (constraints.restrictions.length > 0) {
    reasoning.push(`Active injury constraints applied: ${constraints.restrictions.join("; ")}.`);
  }
  if (constraints.avoidMovements.length > 0) {
    reasoning.push(`Avoided movements: ${constraints.avoidMovements.join(", ")}.`);
  }

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
    createdAt: `${startDate}T00:00:00Z`
  };
}
