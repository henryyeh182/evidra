import { assertValidDecision } from "./models.js";

// Deterministic thresholds. These are the training-science rules, kept as data
// so they can be tuned and reviewed without touching control flow.
const RULES = {
  readinessRest: 40, // below this, train nothing hard
  readinessReduce: 60, // below this, pull intensity down
  readinessAdvance: 85, // above this (and fresh), allow a step up
  muscleFatigueHigh: 65, // target muscle too fatigued for high intensity
  muscleFatigueModerate: 45,
  acwrHigh: 1.4 // acute:chronic ratio above this = spike
};

const INTENSITY_ORDER = ["low", "moderate", "high"];

// When several rules fire, the reported type is the most consequential one, not
// the last one to run. Removing a contraindicated movement must never be masked
// by a routine intensity tweak.
const TYPE_SEVERITY = { keep: 0, advance: 1, adjust: 2, substitute: 3, defer: 4 };

function lowerIntensity(intensity) {
  const index = INTENSITY_ORDER.indexOf(intensity);
  return INTENSITY_ORDER[Math.max(0, index - 1)];
}

function raiseIntensity(intensity) {
  const index = INTENSITY_ORDER.indexOf(intensity);
  return INTENSITY_ORDER[Math.min(INTENSITY_ORDER.length - 1, index + 1)];
}

/** Peak fatigue across the muscles this session actually targets. */
function targetFatigue(session, muscleFatigue = {}) {
  const groups = session.targetMuscleGroups || [];
  let worst = { group: null, value: 0 };
  for (const group of groups) {
    const value = muscleFatigue[group] ?? 0;
    if (value > worst.value) worst = { group, value };
  }
  return worst;
}

function toSessionShape(session) {
  if (!session) return null;
  return {
    sessionId: session.id,
    focus: session.focus,
    type: session.type,
    durationMinutes: session.durationMinutes,
    intensity: session.intensity,
    exercises: [...(session.exercises || [])]
  };
}

function diffShapes(from, to) {
  if (!from || !to) return [];
  const changed = [];
  for (const field of ["focus", "type", "durationMinutes", "intensity"]) {
    if (from[field] !== to[field]) changed.push(field);
  }
  if (JSON.stringify(from.exercises) !== JSON.stringify(to.exercises)) {
    changed.push("exercises");
  }
  return changed;
}

/**
 * Decide what today's scheduled session should become, given today's evidence.
 *
 * This is the product's core primitive. It is deliberately *not* a
 * recommendation: without `scheduledSession` there is no prior state, so there
 * is nothing to decide and the caller is told so explicitly.
 *
 * @param {{ scheduledSession: object|null, state: object, availableMinutes?: number }} input
 * @returns {import("./models.js").SessionDecision}
 */
export function decideSession({ scheduledSession, state, availableMinutes } = {}) {
  if (!state) {
    throw new Error("decideSession requires today's state.");
  }

  const evidence = [];
  const reason = [];
  const limits = [];

  const readiness = state.readinessScore;
  evidence.push({ signal: "readiness", value: readiness, recordedAt: state.date });

  const fatigue = targetFatigue(scheduledSession || {}, state.muscleFatigue);
  if (fatigue.group) {
    evidence.push({
      signal: `muscle_fatigue.${fatigue.group}`,
      value: fatigue.value,
      recordedAt: state.date
    });
  }
  if (typeof state.acuteChronicWorkloadRatio === "number") {
    evidence.push({
      signal: "acute_chronic_workload_ratio",
      value: state.acuteChronicWorkloadRatio,
      recordedAt: state.date
    });
  }

  const stateSummary = {
    readiness,
    recovery: state.recoveryScore,
    fatigue: state.fatigueScore,
    acwr: state.acuteChronicWorkloadRatio,
    targetMuscleFatigue: fatigue.group ? { group: fatigue.group, value: fatigue.value } : null
  };

  // No prior state => no decision is possible. Say so rather than degrading
  // into a recommendation.
  if (!scheduledSession) {
    const result = {
      evidence,
      state: stateSummary,
      decision: { type: "keep", intent: "no_scheduled_session" },
      action: { from: null, to: null, changed: [] },
      reason: ["今天沒有排定的課表，無既有狀態可調整——這是推薦問題，不是決策問題。"],
      confidence: state.confidence || "low",
      signalCoverage: state.signalCoverage || { usable: [], missing: [] },
      limits: ["沒有計畫就只能推薦；請先建立訓練計畫，決策才成立。"]
    };
    assertValidDecision(result);
    return result;
  }

  const from = toSessionShape(scheduledSession);
  const to = { ...from, exercises: [...from.exercises] };
  let type = "keep";
  let intent = "proceed_as_planned";

  const escalate = (candidateType, candidateIntent) => {
    if (TYPE_SEVERITY[candidateType] > TYPE_SEVERITY[type]) {
      type = candidateType;
      intent = candidateIntent;
    }
  };

  // 1. Safety first: injury restrictions hard-filter the session's movements.
  //    This is a guarantee, not advice — it cannot be reasoned away.
  const restrictions = state.avoid || [];
  const blockedExercises = to.exercises.filter((name) =>
    restrictions.some((restriction) => {
      const words = String(restriction).toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
      return words.some((word) => word.length > 3 && name.toLowerCase().includes(word));
    })
  );
  if (blockedExercises.length > 0) {
    to.exercises = to.exercises.filter((name) => !blockedExercises.includes(name));
    if (to.exercises.length === 0) to.exercises = ["Bodyweight circuit"];
    escalate("substitute", "remove_contraindicated_movements");
    reason.push(`移除受限動作 ${blockedExercises.join("、")}（限制：${restrictions.join("；")}）`);
  }

  // 2. Readiness gates the intensity.
  if (readiness < RULES.readinessRest) {
    to.intensity = "low";
    to.type = "recovery";
    to.focus = "Recovery + mobility";
    to.durationMinutes = Math.min(to.durationMinutes, 30);
    escalate("defer", "swap_to_recovery");
    reason.push(`Readiness ${readiness} 低於 ${RULES.readinessRest}，今日不宜訓練負荷，改為恢復。`);
  } else if (readiness < RULES.readinessReduce && from.intensity !== "low") {
    to.intensity = lowerIntensity(to.intensity);
    escalate("adjust", "reduce_today_intensity");
    reason.push(`Readiness ${readiness} 低於 ${RULES.readinessReduce}，需調降強度。`);
  }

  // 3. Muscle-specific fatigue on the muscles this session targets.
  if (fatigue.group && fatigue.value >= RULES.muscleFatigueHigh && to.intensity === "high") {
    to.intensity = lowerIntensity(to.intensity);
    escalate("adjust", "reduce_today_intensity");
    reason.push(`${fatigue.group} 疲勞 ${fatigue.value} 偏高，避免今日高強度刺激同一肌群，再降一級。`);
  } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueModerate && to.intensity === "high") {
    reason.push(`${fatigue.group} 疲勞 ${fatigue.value} 中等，保留強度但需留意主觀感受。`);
  }

  // 4. Acute load spike.
  if (state.acuteChronicWorkloadRatio > RULES.acwrHigh && to.intensity !== "low") {
    to.intensity = lowerIntensity(to.intensity);
    escalate("adjust", "reduce_today_intensity");
    reason.push(`急慢性負荷比 ${state.acuteChronicWorkloadRatio} 高於 ${RULES.acwrHigh}，近期負荷上升過快，再降一級。`);
  }

  // 5. Time budget.
  const budget = availableMinutes ?? state.availableTimeMinutes;
  if (typeof budget === "number" && to.durationMinutes > budget) {
    reason.push(`可用時間僅 ${budget} 分鐘，時長需縮短。`);
    to.durationMinutes = budget;
    escalate("adjust", "fit_time_budget");
  }

  // 6. Room to progress: only when nothing above pulled anything down, and only
  //    when no restriction is active. Pushing intensity on someone with a live
  //    injury constraint is exactly the failure mode a safety rule must prevent,
  //    so this stays conservative even when readiness looks excellent.
  if (
    type === "keep" &&
    restrictions.length === 0 &&
    readiness >= RULES.readinessAdvance &&
    (fatigue.value || 0) < RULES.muscleFatigueModerate &&
    from.intensity !== "high"
  ) {
    to.intensity = raiseIntensity(to.intensity);
    escalate("advance", "increase_today_intensity");
    reason.push(`Readiness ${readiness} 充足且 ${fatigue.group || "目標肌群"} 疲勞低，強度可由 ${from.intensity} 提升為 ${to.intensity}。`);
  }

  if (
    type === "keep" &&
    restrictions.length > 0 &&
    readiness >= RULES.readinessAdvance &&
    from.intensity !== "high"
  ) {
    reason.push(`Readiness ${readiness} 雖高，但有活動中的限制（${restrictions.join("；")}），不提升強度。`);
  }

  const changed = diffShapes(from, to);
  if (type !== "keep" && changed.length === 0) {
    type = "keep";
    intent = "proceed_as_planned";
  }
  if (type === "keep" && reason.length === 0) {
    reason.push(`Readiness ${readiness}、目標肌群疲勞 ${fatigue.value || 0}，均在可執行範圍，照原定課表執行。`);
  }

  const coverage = state.signalCoverage || { usable: [], missing: [] };
  if (coverage.missing?.length > 0) {
    limits.push(`缺少 ${coverage.missing.join("、")} 訊號，信心下調。`);
  }

  const result = {
    evidence,
    state: stateSummary,
    decision: { type, intent },
    action: { from, to: changed.length > 0 ? to : from, changed },
    reason,
    confidence: state.confidence || "low",
    signalCoverage: coverage,
    limits
  };

  assertValidDecision(result);
  return result;
}

export { RULES };
