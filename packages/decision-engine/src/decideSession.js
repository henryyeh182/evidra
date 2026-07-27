import { assertValidDecision } from "./models.js";

// Deterministic thresholds. These are the training-science rules, kept as data
// so they can be tuned and reviewed without touching control flow.
const RULES = {
  readinessRest: 40, // below this, train nothing hard
  readinessReduce: 60, // below this, pull intensity down
  readinessAdvance: 85, // above this (and fresh), allow a step up
  muscleFatigueMaxed: 90, // target muscle fully loaded — two steps off
  muscleFatigueHigh: 65, // target muscle too fatigued for high intensity
  muscleFatigueModerate: 45,
  acwrHigh: 1.4, // acute:chronic ratio above this = spike
  recoveryCapMinutes: 30 // how long a swapped-in recovery session may run
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

  // 2-4. Each safety rule states how many intensity steps it demands, judged
  //    against the session AS PLANNED. Applying them in sequence instead let an
  //    earlier rule's downgrade switch off a later one: a readiness drop to
  //    moderate made the `intensity === "high"` fatigue check false, so legs at
  //    100/100 the day after a hard run went unmentioned and unacted on. Rules
  //    are now independent, the largest demand wins, and every rule that fires
  //    contributes its reason.
  let stepsDown = 0;
  const demand = (steps, text) => {
    stepsDown = Math.max(stepsDown, steps);
    reason.push(text);
    escalate("adjust", "reduce_today_intensity");
  };

  // 2. Readiness.
  if (readiness < RULES.readinessRest) {
    to.intensity = "low";
    to.type = "recovery";
    to.focus = "Recovery + mobility";
    // The cap is the recovery rule's own, driven by readiness — not a claim
    // about how much time the athlete has.
    to.durationMinutes = Math.min(to.durationMinutes, RULES.recoveryCapMinutes);
    escalate("defer", "swap_to_recovery");
    reason.push(
      `Readiness ${readiness} 低於 ${RULES.readinessRest}，今日不宜訓練負荷，改為 ${RULES.recoveryCapMinutes} 分鐘以內的恢復課表。`
    );
  } else {
    if (readiness < RULES.readinessReduce && from.intensity !== "low") {
      demand(1, `Readiness ${readiness} 低於 ${RULES.readinessReduce}，需調降強度。`);
    }

    // 3. Fatigue in the muscles this session actually targets. A maxed-out
    //    group warrants two steps: one notch off a hard day still leaves it
    //    training the same fatigued tissue.
    if (fatigue.group && fatigue.value >= RULES.muscleFatigueMaxed) {
      demand(2, `${fatigue.group} 疲勞 ${fatigue.value} 已達上限，同一肌群今日不宜再受刺激。`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueHigh) {
      demand(1, `${fatigue.group} 疲勞 ${fatigue.value} 偏高，避免今日高強度刺激同一肌群。`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueModerate && from.intensity === "high") {
      reason.push(`${fatigue.group} 疲勞 ${fatigue.value} 中等，保留強度但需留意主觀感受。`);
    }

    // 4. Acute load spike.
    if (state.acuteChronicWorkloadRatio > RULES.acwrHigh) {
      demand(1, `急慢性負荷比 ${state.acuteChronicWorkloadRatio} 高於 ${RULES.acwrHigh}，近期負荷上升過快。`);
    }

    for (let step = 0; step < stepsDown; step += 1) {
      to.intensity = lowerIntensity(to.intensity);
    }
  }

  // 5. Time budget. Only a stated budget counts, and the one we act on is
  //    recorded as evidence like every other signal. A cut we cannot cite is a
  //    fabricated reason: an upstream default of 30 used to arrive here
  //    indistinguishable from a real constraint, halving a 60-minute session and
  //    telling the athlete their time was short on evidence nobody supplied.
  //    Reason must trace back to evidence — no evidence entry, no cut.
  const budget =
    typeof availableMinutes === "number"
      ? { minutes: availableMinutes, source: "session_override" }
      : typeof state.availableTimeMinutes === "number"
        ? { minutes: state.availableTimeMinutes, source: "user_constraint" }
        : null;

  if (budget) {
    evidence.push({
      signal: "available_minutes",
      value: budget.minutes,
      recordedAt: state.date,
      source: budget.source
    });
    if (to.durationMinutes > budget.minutes) {
      reason.push(`可用時間僅 ${budget.minutes} 分鐘，時長需縮短。`);
      to.durationMinutes = budget.minutes;
      escalate("adjust", "fit_time_budget");
    }
  } else {
    limits.push("未取得今日可用時間，時長維持原定，未依時間裁切。");
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
