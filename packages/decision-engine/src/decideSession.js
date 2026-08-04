// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidDecision } from "./models.js";

const EMPTY_COVERAGE = { usable: [], missing: [] };

/**
 * Signal coverage in the two-group shape, whatever the caller had.
 *
 * The state travels with the call, so a caller holding one produced before
 * coverage was split still sends the flat `{usable, missing}`. That shape only
 * ever described recovery signals, so it is read as recovery and the training
 * half comes back empty — an unknown gap is reported as no claim, never as
 * "nothing was missing".
 */
// "1 days of evidence" reads as a bug in the sentence even when the number is
// right, and these strings are what a host speaks to the user.
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function normalizeCoverage(signalCoverage) {
  if (!signalCoverage) {
    return { recovery: { ...EMPTY_COVERAGE }, training: { ...EMPTY_COVERAGE } };
  }

  if (Array.isArray(signalCoverage.usable) || Array.isArray(signalCoverage.missing)) {
    return {
      recovery: {
        usable: signalCoverage.usable ?? [],
        missing: signalCoverage.missing ?? []
      },
      training: { ...EMPTY_COVERAGE }
    };
  }

  return {
    recovery: { ...EMPTY_COVERAGE, ...(signalCoverage.recovery ?? {}) },
    training: { ...EMPTY_COVERAGE, ...(signalCoverage.training ?? {}) }
  };
}

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
  recoveryCapMinutes: 30, // how long a swapped-in recovery session may run
  // Coming back from a break. A returning athlete restarts at roughly half to
  // two-thirds of prior volume; 0.6 sits inside that and is a cap, not a target,
  // so a session already shorter than the cap is left alone.
  returnDurationFactor: 0.6,
  // Past either of these the break stopped being a pause and started being a
  // reset — one notch off the planned intensity is not enough.
  returnSevereIdleDays: 42,
  returnSevereCtlLossPct: 60
};

const INTENSITY_ORDER = ["low", "moderate", "high"];

// How a session is named once its intensity has been pulled down. The planned
// focus describes a stimulus ("VO₂max Intervals"); at low intensity that name
// no longer describes what the athlete is being told to do, and an action whose
// `to` reads "VO₂max Intervals, 60 min, low" is not executable as written.
// Derived from intensity and type alone — no zone, no pace, nothing the
// evidence does not carry.
const INTENSITY_LABEL = { low: "Easy", moderate: "Moderate", high: "Hard" };
// `type` is optional on the input contract, and a session that omits it used to
// produce the literal string "Easy undefined" in `action.to.focus` — the field
// the athlete actually reads. Nothing is invented to fill the gap: with no type
// the name carries only the intensity, which is the part that changed anyway.
// The intensity itself is guaranteed by `intensityStated`, which is what lets
// the relabel run at all.
const relabelForIntensity = (session) =>
  session.type
    ? `${INTENSITY_LABEL[session.intensity]} ${session.type}`
    : `${INTENSITY_LABEL[session.intensity]} session`;

// What a deferred session becomes. Deliberately equipment-free so the swap
// holds whatever the athlete has, and low-impact so it stays valid under the
// joint restrictions that often accompany a low-readiness day.
//
// Canonical ids, not names. These were the free-text strings "Easy walk" and
// "Mobility flow", which resolved to nothing: the catalog calls the same two
// movements Recovery Walk and Lower Body Mobility Flow, so a caller who wanted
// to ask what was in the swapped-in session had nothing to look up.
const RECOVERY_MOVEMENT_IDS = ["exercise_recovery_walk", "exercise_lower_body_mobility"];

// When every movement in the session was contraindicated. Same reasoning as the
// planner's fallback: an id, so the caller can look it up.
const FALLBACK_EXERCISE_ID = "exercise_bodyweight_squat";

// See generatePlan: the caller injects a catalog-backed spelling; on its own
// this package hands back the id, which is the canonical form.
const identityDisplay = (id) => id;

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

function toSessionShape(session, displayNameFor) {
  if (!session) return null;
  // Callers hand us whatever their agent had. `exerciseIds` is the canonical
  // form; `exercises` is accepted as a fallback so a caller that has not been
  // normalized at the tool boundary still gets a decision rather than an error.
  const exerciseIds = [...(session.exerciseIds || session.exercises || [])];
  return {
    sessionId: session.id,
    focus: session.focus,
    type: session.type,
    durationMinutes: session.durationMinutes,
    intensity: session.intensity,
    exerciseIds,
    exercises: exerciseIds.map((id) => displayNameFor(id))
  };
}

function diffShapes(from, to) {
  if (!from || !to) return [];
  const changed = [];
  for (const field of ["focus", "type", "durationMinutes", "intensity"]) {
    if (from[field] !== to[field]) changed.push(field);
  }
  // Compared on ids: the canonical form is what actually changed or did not.
  if (JSON.stringify(from.exerciseIds) !== JSON.stringify(to.exerciseIds)) {
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
export function decideSession({
  scheduledSession,
  proposedSession,
  state,
  availableMinutes,
  displayNameFor,
  intensityDistributions
} = {}) {
  const speak = displayNameFor || identityDisplay;
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

  // Time away and fitness lost. Cited as evidence in their own right because
  // the rule below acts on them, and a reason we cannot trace to evidence is a
  // fabricated reason.
  const detraining = state.trainingLoad?.detraining;
  if (detraining && typeof detraining.daysSinceLastSession === "number") {
    evidence.push({
      signal: "days_since_last_session",
      value: detraining.daysSinceLastSession,
      recordedAt: state.date
    });
    evidence.push({
      signal: "chronic_load_loss_pct",
      value: detraining.ctlLossPct,
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
      reason: [
        "Nothing is scheduled today, so there is no prior state to change. This is a recommendation question, not a decision."
      ],
      confidence: state.confidence || "low",
      signalCoverage: normalizeCoverage(state.signalCoverage),
      limits: ["Without a plan only a recommendation is possible; a decision needs a scheduled session."]
    };
    assertValidDecision(result);
    return result;
  }

  const from = toSessionShape(scheduledSession, speak);
  const to = { ...from, exerciseIds: [...from.exerciseIds], exercises: [...from.exercises] };
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
  // Matched against the spoken name only. Restrictions are written the way a
  // person talks ("avoid heavy lower body"), and an id's slug carries anatomy
  // words that are not claims about the movement — matching the raw id made
  // "avoid heavy lower body" strike exercise_lower_body_mobility, the very
  // movement the recovery swap relies on being safe.
  const blockedIds = to.exerciseIds.filter((id) => {
    const haystack = String(speak(id)).toLowerCase();
    return restrictions.some((restriction) => {
      const words = String(restriction).toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
      return words.some((word) => word.length > 3 && haystack.includes(word));
    });
  });
  if (blockedIds.length > 0) {
    to.exerciseIds = to.exerciseIds.filter((id) => !blockedIds.includes(id));
    if (to.exerciseIds.length === 0) to.exerciseIds = [FALLBACK_EXERCISE_ID];
    to.exercises = to.exerciseIds.map((id) => speak(id));
    escalate("substitute", "remove_contraindicated_movements");
    reason.push(
      `Removed restricted movements: ${blockedIds.map((id) => speak(id)).join(", ")} (restrictions: ${restrictions.join("; ")}).`
    );
  }

  // 2-4. Each safety rule states how many intensity steps it demands, judged
  //    against the session AS PLANNED. Applying them in sequence instead let an
  //    earlier rule's downgrade switch off a later one: a readiness drop to
  //    moderate made the `intensity === "high"` fatigue check false, so legs at
  //    100/100 the day after a hard run went unmentioned and unacted on. Rules
  //    are now independent, the largest demand wins, and every rule that fires
  //    contributes its reason.
  // Every rule below acts by moving the session's intensity down from where it
  // was planned, which requires knowing where that was. `intensity` is optional
  // on the input contract and no connector can fill it — it describes a session
  // that has not happened, so it exists only in the caller's plan. With it
  // absent, `lowerIntensity(undefined)` used to return "low" (indexOf gives -1,
  // and the clamp reads that as the bottom of the scale), and the athlete was
  // told their intensity had come down to low from a value nobody supplied.
  // That reads entirely plausible, which is what made it worth guarding.
  const intensityStated = INTENSITY_ORDER.includes(from.intensity);

  let stepsDown = 0;
  let intensityUnstatedBlockedARule = false;
  const demand = (steps, text, asIntent = "reduce_today_intensity") => {
    if (!intensityStated) {
      // The reason strings name both the observation and the remedy ("...so
      // intensity comes down"), and the remedy is not available here. Reporting
      // one without the other would be prose contradicting `limits`, so the
      // rule is recorded as blocked instead. The readings that triggered it —
      // readiness, target-muscle fatigue, ACWR, days idle — are already in
      // `evidence`, so nothing is hidden by not restating them.
      intensityUnstatedBlockedARule = true;
      return;
    }
    stepsDown = Math.max(stepsDown, steps);
    reason.push(text);
    escalate("adjust", asIntent);
  };

  // 2. Readiness.
  if (readiness < RULES.readinessRest) {
    to.intensity = "low";
    to.type = "recovery";
    to.focus = "Recovery + mobility";
    // The session's movements have to change with it. Leaving the planned
    // exercises in place produced a record that contradicted itself — a "to"
    // reading "Recovery + mobility" while still prescribing VO₂max intervals.
    to.exerciseIds = [...RECOVERY_MOVEMENT_IDS];
    to.exercises = to.exerciseIds.map((id) => speak(id));
    // The cap is the recovery rule's own, driven by readiness — not a claim
    // about how much time the athlete has.
    to.durationMinutes = Math.min(to.durationMinutes, RULES.recoveryCapMinutes);
    escalate("defer", "swap_to_recovery");
    reason.push(
      `Readiness ${readiness} is below ${RULES.readinessRest}: no training load today, swapped to a recovery session of at most ${RULES.recoveryCapMinutes} minutes.`
    );
  } else {
    if (readiness < RULES.readinessReduce && from.intensity !== "low") {
      demand(1, `Readiness ${readiness} is below ${RULES.readinessReduce}, so intensity comes down.`);
    }

    // 3. Fatigue in the muscles this session actually targets. A maxed-out
    //    group warrants two steps: one notch off a hard day still leaves it
    //    training the same fatigued tissue.
    if (fatigue.group && fatigue.value >= RULES.muscleFatigueMaxed) {
      demand(2, `${fatigue.group} fatigue is ${fatigue.value}, at the ceiling: that muscle group takes no further stimulus today.`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueHigh) {
      demand(1, `${fatigue.group} fatigue is ${fatigue.value}, high enough to rule out hard work on the same muscle group today.`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueModerate && from.intensity === "high") {
      reason.push(`${fatigue.group} fatigue is ${fatigue.value}, moderate: intensity is kept, but watch how it feels.`);
    }

    // 4. Acute load spike.
    if (state.acuteChronicWorkloadRatio > RULES.acwrHigh) {
      demand(1, `Acute:chronic workload ratio ${state.acuteChronicWorkloadRatio} is above ${RULES.acwrHigh}: load has been ramping too fast.`);
    }

    // 5. Coming back from a break. Nothing above can see this. An athlete two
    //    months off reads *rested*: readiness high, target-muscle fatigue near
    //    zero, and ACWR at 0 — which is the safest possible value to the
    //    ramp-rate check that just ran. Every guard passed, and the engine
    //    handed a detrained athlete their original high-intensity session
    //    unchanged. Recovery signals measure recovery; they say nothing about
    //    the fitness that decayed while the athlete was resting, so lost
    //    fitness gets its own rule rather than being inferred from readiness.
    if (detraining?.active) {
      const severe =
        detraining.daysSinceLastSession >= RULES.returnSevereIdleDays ||
        detraining.ctlLossPct >= RULES.returnSevereCtlLossPct;
      demand(
        severe ? 2 : 1,
        `${detraining.daysSinceLastSession} days since the last session and chronic load is down ${detraining.ctlLossPct}% from its peak: fitness has decayed, so the first session back is scaled down.`,
        "ease_back_after_break"
      );

      // Volume has to come down with intensity. Holding the planned duration
      // would just move the overload from intensity to time.
      const cap = Math.max(15, Math.round(from.durationMinutes * RULES.returnDurationFactor));
      if (to.durationMinutes > cap) {
        reason.push(`First session back: duration cut from ${from.durationMinutes} to ${cap} minutes (${Math.round(RULES.returnDurationFactor * 100)}% of planned).`);
        to.durationMinutes = cap;
      }
    }

    if (intensityUnstatedBlockedARule) {
      limits.push(
        "The evidence called for this session's intensity to come down, but the scheduled session states no intensity, so none was changed. Supply `scheduledSession.intensity` (low, moderate or high) to get that part of the decision."
      );
    }

    for (let step = 0; step < stepsDown; step += 1) {
      to.intensity = lowerIntensity(to.intensity);
    }

    // The name has to follow the intensity. Leaving it alone produced an action
    // that contradicted itself — "VO₂max Intervals, 60 min, low" is not a
    // session anyone can execute, and the athlete reading it cannot tell
    // whether to run the intervals or not. Same reasoning as the recovery swap
    // above, which already rewrites `focus` when the session's nature changes.
    if (to.intensity !== from.intensity) {
      const relabelled = relabelForIntensity(to);
      if (relabelled !== to.focus) {
        reason.push(`At ${to.intensity} intensity the session is no longer "${from.focus}"; it becomes "${relabelled}".`);
        to.focus = relabelled;
      }
    }
  }

  // 6. Time budget. Only a stated budget counts, and the one we act on is
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
      reason.push(`Only ${budget.minutes} minutes are available, so the session is shortened.`);
      to.durationMinutes = budget.minutes;
      escalate("adjust", "fit_time_budget");
    }
  } else {
    // Says only what it knows: no budget was supplied, so no time-based cut was
    // made. It must not claim the duration is unchanged — another rule may have
    // shortened it for reasons that have nothing to do with the clock.
    limits.push("No available-time figure was supplied, so no time-based cut was made.");
  }

  // 7. Room to progress: only when nothing above pulled anything down, and only
  //    when no restriction is active. Pushing intensity on someone with a live
  //    injury constraint is exactly the failure mode a safety rule must prevent,
  //    so this stays conservative even when readiness looks excellent.
  //
  //    Detraining is named explicitly rather than left to the `type === "keep"`
  //    guard: a well-rested returning athlete scores high readiness and low
  //    fatigue, which is precisely this rule's entry condition. Being fresh is
  //    not the same as being ready to progress.
  //
  //    Stepping up has the same prerequisite as stepping down: you cannot move
  //    a value you were never given. `raiseIntensity(undefined)` lands on "low"
  //    for the same reason its counterpart does, so an unstated intensity would
  //    be reported as having *risen* to low — and the sentence below would read
  //    "steps up from undefined to low".
  if (
    type === "keep" &&
    intensityStated &&
    !detraining?.active &&
    restrictions.length === 0 &&
    readiness >= RULES.readinessAdvance &&
    (fatigue.value || 0) < RULES.muscleFatigueModerate &&
    from.intensity !== "high"
  ) {
    to.intensity = raiseIntensity(to.intensity);
    escalate("advance", "increase_today_intensity");
    reason.push(`Readiness ${readiness} is ample and ${fatigue.group || "the target muscle group"} fatigue is low, so intensity steps up from ${from.intensity} to ${to.intensity}.`);
  }

  if (
    type === "keep" &&
    restrictions.length > 0 &&
    readiness >= RULES.readinessAdvance &&
    from.intensity !== "high"
  ) {
    reason.push(`Readiness ${readiness} is high, but active restrictions (${restrictions.join("; ")}) are in force, so intensity is not raised.`);
  }

  // 8. The athlete proposed something.
  //
  //    "Today was cardio — can I do mobility work instead?" is a different
  //    question from "what should I do today", and until now the engine only
  //    answered the second one. It applied its own rules and handed back its
  //    own `to`, leaving a proposed alternative unaddressed — which reads as
  //    ignoring the person who asked.
  //
  //    Adjudicating a proposal needs no new thresholds. Rules 1-7 just
  //    established what today can carry; that is the ceiling. A proposal at or
  //    under it on every axis is admissible, one that exceeds it on any axis is
  //    not, and the axis that failed is the reason. Being *more* conservative
  //    than the ceiling is always allowed — an athlete may rest more than
  //    required, never less.
  let proposal = null;
  if (proposedSession) {
    const wanted = toSessionShape(proposedSession, speak);
    const violations = [];

    if (INTENSITY_ORDER.indexOf(wanted.intensity) > INTENSITY_ORDER.indexOf(to.intensity)) {
      violations.push(
        `Proposed intensity ${wanted.intensity} exceeds today's ceiling of ${to.intensity}.`
      );
    }
    if (wanted.durationMinutes > to.durationMinutes) {
      violations.push(`Proposed duration ${wanted.durationMinutes} minutes exceeds today's ceiling of ${to.durationMinutes} minutes.`);
    }

    // The fatigue rules above were judged against the *scheduled* session's
    // target muscles. A proposal can point at a different group, and a fresh
    // group is exactly why swapping is often the right call — but a proposal
    // aimed at an already-loaded group has to be caught here or it slips past
    // every check that ran.
    const wantedFatigue = targetFatigue(proposedSession, state.muscleFatigue);
    if (wantedFatigue.group && wantedFatigue.value >= RULES.muscleFatigueHigh && wanted.intensity !== "low") {
      violations.push(
        `The proposal targets ${wantedFatigue.group}, whose fatigue is ${wantedFatigue.value}: only low intensity is admissible there today.`
      );
    }

    // Contraindications are a guarantee, so they apply to a proposal exactly as
    // they applied to the plan. Nothing the athlete asks for can switch them off.
    const wantedBlocked = wanted.exerciseIds.filter((id) => {
      const haystack = String(speak(id)).toLowerCase();
      return restrictions.some((restriction) => {
        const words = String(restriction).toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
        return words.some((word) => word.length > 3 && haystack.includes(word));
      });
    });
    if (wantedBlocked.length > 0) {
      violations.push(
        `The proposal includes restricted movements: ${wantedBlocked.map((id) => speak(id)).join(", ")} (restrictions: ${restrictions.join("; ")}).`
      );
    }

    if (violations.length === 0) {
      proposal = { verdict: "accepted", violations: [] };
      reason.push(
        `The proposed "${wanted.focus || wanted.type}" sits within today's ceiling (${to.intensity} intensity, ${to.durationMinutes} minutes), so it is accepted.`
      );
      // The proposal becomes the action. Everything the rules capped still
      // holds — it passed those caps, that is why it was accepted.
      to.focus = wanted.focus;
      to.type = wanted.type;
      to.intensity = wanted.intensity;
      to.durationMinutes = wanted.durationMinutes;
      to.exerciseIds = [...wanted.exerciseIds];
      to.exercises = to.exerciseIds.map((id) => speak(id));
      escalate("substitute", "accept_athlete_proposal");
    } else {
      // Rejected, but not left hanging: the action stays the engine's own `to`,
      // so the answer is still "here is what today should be", with the reason
      // the alternative was refused.
      proposal = { verdict: "rejected", violations };
      for (const violation of violations) reason.push(violation);
      limits.push("The proposal was not accepted; the action stays what the evidence supports.");
    }
  }

  const changed = diffShapes(from, to);
  if (type !== "keep" && changed.length === 0) {
    type = "keep";
    intent = "proceed_as_planned";
  }
  if (type === "keep" && reason.length === 0) {
    // "Both within range" is a claim about the evidence, and it is false when a
    // rule fired and could not be applied. Saying it anyway would turn a
    // withheld adjustment into an all-clear, which is the opposite of what the
    // readings showed.
    reason.push(
      intensityUnstatedBlockedARule
        ? `The session is unchanged, but not because the evidence was clear: readiness ${readiness} and target-muscle fatigue ${fatigue.value || 0} called for a lower intensity that could not be applied. See limits.`
        : `Readiness ${readiness} and target-muscle fatigue ${fatigue.value || 0} are both within range, so the session runs as planned.`
    );
  }

  const coverage = normalizeCoverage(state.signalCoverage);
  if (coverage.recovery.missing.length > 0) {
    limits.push(`No ${coverage.recovery.missing.join(", ")} signal was available, so confidence is lowered.`);
  }
  if (coverage.training.missing.length > 0) {
    limits.push(
      `Some sessions in the last 7 days carry no training load, ` +
        `so muscle fatigue is read from an incomplete week.`
    );
  }

  // The acute:chronic ratio is the one number here that can look authoritative
  // while resting on almost nothing, because a thin chronic window still divides
  // cleanly. Caught in the field: a ratio of 0.17 computed from a single session,
  // which reads as severe detraining and meant only that the evidence was one day
  // deep. The caveat ships with the ratio rather than being left for the caller
  // to work out.
  const acwrCoverage = state.acwrCoverage;
  if (acwrCoverage && !acwrCoverage.sufficientHistory) {
    limits.push(
      `The acute:chronic ratio ${state.acuteChronicWorkloadRatio} is built on ` +
        `${count(acwrCoverage.historyDays, "day")} of evidence ` +
        `(${count(acwrCoverage.sessionsInWindow, "session")}) ` +
        `against a ${acwrCoverage.chronicWindowDays}-day chronic window, so it reflects how little ` +
        `history was supplied more than how this week compares to a normal one.`
    );
  }
  if (acwrCoverage && acwrCoverage.chronicBasis === "baseline_floor") {
    limits.push(
      "Observed chronic load was below the assumed weekly target, so the ratio is measured " +
        "against that target rather than against this person's own chronic load."
    );
  }

  // Per-session intensity distribution is carried, not consumed. Saying so is
  // the point: a caller who supplied zone data deserves to know the decision
  // did not weigh it, rather than assuming it did. No rule reads these values —
  // inventing a threshold from one athlete's sessions is how an engine gets
  // fitted to a single person.
  const distributions = intensityDistributions || [];
  if (distributions.length > 0) {
    const sources = [...new Set(distributions.map((entry) => entry.boundarySource).filter(Boolean))];
    limits.push(
      `${distributions.length} sessions carry a heart-rate zone distribution (boundary source: ${sources.join(", ") || "unlabelled"}). ` +
        `They are recorded as evidence, but no decision rule reads them — thresholds are not set from one athlete's data.`
    );
  }

  const result = {
    evidence,
    state: stateSummary,
    decision: { type, intent },
    action: { from, to: changed.length > 0 ? to : from, changed },
    reason,
    confidence: state.confidence || "low",
    signalCoverage: coverage,
    ...(proposal ? { proposal } : {}),
    limits
  };

  assertValidDecision(result);
  return result;
}

export { RULES };
