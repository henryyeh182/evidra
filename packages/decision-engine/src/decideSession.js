// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { assertValidDecision } from "./models.js";
import { ENGINE_VERSION } from "./version.js";
import {
  THRESHOLDS,
  combineIntensitySteps,
  buildDecisionBasis,
  ENGINE_THRESHOLD_KEYS
} from "../../rules/src/index.js";

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

// What each coverage key is called in a sentence. An unmapped key falls back to
// itself rather than being dropped: a signal missing from this table must still
// be reported, and an odd-looking word is a smaller failure than silence.
const SIGNAL_WORDS = {
  sleep: "sleep",
  hrv: "HRV",
  restingHeartRate: "resting heart rate",
  stress: "stress",
  trainingLoad: "training load"
};

function listSignals(keys) {
  const words = keys.map((key) => SIGNAL_WORDS[key] || key);
  const verb = words.length === 1 ? "reading was" : "readings were";
  const list =
    words.length <= 1
      ? words.join("")
      : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
  return `No ${list} ${verb} supplied`;
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

// Every threshold this engine applies comes from the rule library, and none of
// them are written here.
//
// That is the whole point of the indirection. A number living in this file is a
// number with no stated origin: a reader has to take "readinessRest: 40" on
// trust, and nothing stops the next edit from adding a forty-first. In
// `rule-packages/base_rules/rules/session-rules.json` the same value cannot exist without
// declaring which rule owns it, what quantity it cuts, whether that quantity is
// externally defined or one Evidra computes itself, and — for the two that are
// externally defined — who published on it and who disputes that publication.
//
// The join is enforced in both directions by `assertThresholdsMatch`: a
// threshold an engine reads but no rule declares fails the load, and so does a
// rule nobody applies. Neither side can drift into decoration.
//
// This engine's side of that contract — which keys this file reads — is
// `ENGINE_THRESHOLD_KEYS.session`, and the union of every engine's list is
// asserted when that module loads, which importing anything from the rules
// package does. It is still maintained by hand, and adding a threshold still
// costs a deliberate edit in two files; the list moved out of this file only
// because a second engine started applying rules, and no single engine can
// assert the direction that matters most — that no rule goes unapplied.
//
// Narrowed to this engine's own keys rather than handed the whole map, so that
// reading a threshold declared for the plan generator or the catalog yields
// undefined here instead of a number from somewhere else.
const RULES = Object.freeze(
  Object.fromEntries(ENGINE_THRESHOLD_KEYS.session.map((key) => [key, THRESHOLDS[key]]))
);

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

/**
 * The part of `decisionBasis` that is true of every decision, rule or no rule:
 * which library, which engine, which policies were in force. Both returns below
 * build on this rather than each assembling their own, so the shape a caller
 * parses cannot differ between a decision that fired rules and one that did
 * not.
 */
function emptyBasis() {
  return buildDecisionBasis({ engineVersion: ENGINE_VERSION });
}

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

/**
 * Which of these movements an active restriction names — EVD-R-009's quantity.
 *
 * One function because it is one rule, asked twice: of the session the plan
 * scheduled, and of the alternative the athlete proposed. It was two copies of
 * the same eight lines, which is how the two came to be edited apart from each
 * other and how `restrictionTokenMinLength` came to be written out twice as a
 * bare 3.
 *
 * Matched against the spoken name only. Restrictions are written the way a
 * person talks ("avoid heavy lower body"), and an id's slug carries anatomy
 * words that are not claims about the movement — matching the raw id made
 * "avoid heavy lower body" strike exercise_lower_body_mobility, the very
 * movement the recovery swap relies on being safe.
 */
function movementsMatchingRestrictions(exerciseIds, restrictions, speak) {
  return exerciseIds.filter((id) => {
    const haystack = String(speak(id)).toLowerCase();
    return restrictions.some((restriction) => {
      const words = String(restriction).toLowerCase().replace(/^avoid\s+/, "").split(/[\s-]+/);
      return words.some(
        (word) => word.length > RULES.restrictionTokenMinLength && haystack.includes(word)
      );
    });
  });
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
  intensityDistributions,
  rpeBasisCounts
} = {}) {
  const speak = displayNameFor || identityDisplay;
  if (!state) {
    throw new Error("decideSession requires today's state.");
  }

  const evidence = [];
  const reason = [];
  const limits = [];

  // null when no recovery signal was supplied at all. It is not a low readiness
  // and it is not a high one: there is no reading, so no rule that cuts on
  // readiness may fire, and the number never enters evidence as though it had
  // been measured. Everything else — muscle fatigue, acute:chronic load, time
  // off — still decides, which is what keeps a training-load-only athlete
  // getting an answer.
  const readiness = state.readinessScore ?? null;
  const readinessKnown = readiness !== null;
  if (readinessKnown) {
    evidence.push({ signal: "readiness", value: readiness, recordedAt: state.date });
  } else {
    // The same correction as the coverage limit below, for the same reason.
    // This used to end "and confidence is held lower to match", which is a
    // counterfactual nothing here computes: with no session in the last two
    // weeks the figure is `low` whether the four readings arrive or not — the
    // shortfall is the history, not the signals. Measured on 2026-08-08.
    limits.push(
      "Readiness was not scored today, because no sleep, HRV, resting heart rate or stress reading arrived and a stand-in number would have decided this session on something nobody measured. The rules that read recovery sat this one out, everything resting on training load still applied, and the confidence figure covers only what was there."
    );
  }

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
      // No rule fired, which is a thing to state rather than to omit. This
      // return used to carry no `decisionBasis` at all — a required field on
      // this tool's own output schema, missing on every call that arrived
      // without a scheduled session, and never caught because the golden set's
      // one decide_session case always supplies one. "No rule was applied" and
      // "we are not saying what this rests on" are different answers, and only
      // the first is true here.
      decisionBasis: emptyBasis(),
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
  //    This is a guarantee, not advice — it cannot be reasoned away. EVD-R-009
  //    is the rule; it fires below, once, after the proposal has been read.
  const restrictions = state.avoid || [];
  const blockedIds = movementsMatchingRestrictions(to.exerciseIds, restrictions, speak);
  if (blockedIds.length >= RULES.restrictedMovementsPresent) {
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

  // Which rules fired, and the reading that fired each one.
  //
  // Recorded even when a rule is blocked from acting: "this rule triggered and
  // could not be applied" is information the athlete is owed, and dropping it
  // would let `decisionBasis` claim the evidence was quiet when it was not.
  const fired = [];
  const fire = (ruleId, measured, applied = true) => {
    fired.push({ ruleId, measured, applied });
  };

  const demand = (ruleId, measured, steps, text, asIntent = "reduce_today_intensity") => {
    if (!intensityStated) {
      fire(ruleId, measured, false);
      // The reason strings name both the observation and the remedy ("...so
      // intensity comes down"), and the remedy is not available here. Reporting
      // one without the other would be prose contradicting `limits`, so the
      // rule is recorded as blocked instead. The readings that triggered it —
      // readiness, target-muscle fatigue, ACWR, days idle — are already in
      // `evidence`, so nothing is hidden by not restating them.
      intensityUnstatedBlockedARule = true;
      return;
    }
    fire(ruleId, measured, true);
    // `most_restrictive_wins`, stated once in the library and applied here.
    stepsDown = combineIntensitySteps([stepsDown, steps]);
    reason.push(text);
    escalate("adjust", asIntent);
  };

  // 2. Readiness.
  if (readinessKnown && readiness < RULES.readinessRest) {
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
    fire("EVD-R-001", { quantity: "readiness_score", value: readiness });
    reason.push(
      `Readiness ${readiness} is below ${RULES.readinessRest}: no training load today, swapped to a recovery session of at most ${RULES.recoveryCapMinutes} minutes.`
    );
  } else {
    if (readinessKnown && readiness < RULES.readinessReduce && from.intensity !== "low") {
      demand(
        "EVD-R-002",
        { quantity: "readiness_score", value: readiness },
        1,
        `Readiness ${readiness} is below ${RULES.readinessReduce}, so intensity comes down.`
      );
    }

    // 3. Fatigue in the muscles this session actually targets. A maxed-out
    //    group warrants two steps: one notch off a hard day still leaves it
    //    training the same fatigued tissue.
    const fatigueReading = { quantity: "muscle_fatigue_score", group: fatigue.group, value: fatigue.value };
    if (fatigue.group && fatigue.value >= RULES.muscleFatigueMaxed) {
      demand("EVD-R-003", fatigueReading, 2, `${fatigue.group} fatigue is ${fatigue.value}, at the ceiling: that muscle group takes no further stimulus today.`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueHigh) {
      demand("EVD-R-004", fatigueReading, 1, `${fatigue.group} fatigue is ${fatigue.value}, high enough to rule out hard work on the same muscle group today.`);
    } else if (fatigue.group && fatigue.value >= RULES.muscleFatigueModerate && from.intensity === "high") {
      // Advisory: EVD-R-005 changes nothing by design, so it fires without
      // demanding a step. It is still recorded — a rule that deliberately holds
      // is part of the basis for holding.
      fire("EVD-R-005", fatigueReading, true);
      reason.push(`${fatigue.group} fatigue is ${fatigue.value}, moderate: intensity is kept, but watch how it feels.`);
    }

    // 4. Acute load spike.
    if (state.acuteChronicWorkloadRatio > RULES.acwrHigh) {
      demand(
        "EVD-R-006",
        {
          quantity: "acute_chronic_workload_ratio",
          value: state.acuteChronicWorkloadRatio,
          chronicBasis: state.acwrCoverage?.chronicBasis ?? null
        },
        1,
        `Acute:chronic workload ratio ${state.acuteChronicWorkloadRatio} is above ${RULES.acwrHigh}: load has been ramping too fast.`
      );
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
        "EVD-R-007",
        {
          quantity: "detraining",
          daysSinceLastSession: detraining.daysSinceLastSession,
          ctlLossPct: detraining.ctlLossPct,
          severe
        },
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
    // Only when there is a length to cut. Said on every call it was noise on
    // four out of five: nobody asked about time, and the answer opened by
    // explaining something that had not happened.
    if (typeof to.durationMinutes === "number") {
      limits.push(
        "Nothing was said about how much time is free today, so the session keeps its planned length. Say how long you have and it will be cut to fit."
      );
    }
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
    readinessKnown &&
    readiness >= RULES.readinessAdvance &&
    (fatigue.value || 0) < RULES.muscleFatigueModerate &&
    from.intensity !== "high"
  ) {
    to.intensity = raiseIntensity(to.intensity);
    escalate("advance", "increase_today_intensity");
    fire("EVD-R-008", {
      quantity: "readiness_score",
      value: readiness,
      targetMuscleFatigue: fatigue.value || 0
    });
    reason.push(`Readiness ${readiness} is ample and ${fatigue.group || "the target muscle group"} fatigue is low, so intensity steps up from ${from.intensity} to ${to.intensity}.`);
  }

  if (
    type === "keep" &&
    restrictions.length > 0 &&
    readinessKnown &&
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
  // Declared out here because EVD-R-009 fires once for both places it looks.
  let proposalBlockedIds = [];
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
    proposalBlockedIds = movementsMatchingRestrictions(wanted.exerciseIds, restrictions, speak);
    if (proposalBlockedIds.length >= RULES.restrictedMovementsPresent) {
      violations.push(
        `The proposal includes restricted movements: ${proposalBlockedIds.map((id) => speak(id)).join(", ")} (restrictions: ${restrictions.join("; ")}).`
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

  // The injury guarantee, recorded as the rule it has always been.
  //
  // Fired here rather than at either of the two places it looks, because it is
  // one rule and `readingFor` is keyed by ruleId: firing twice would leave the
  // decision reporting whichever reading came second as though it were the
  // whole of what the rule saw. Order costs nothing — `arbitrate` sorts by
  // category and priority, not by the order rules fired in.
  //
  // Being category `injury` this governs whenever it fires, which is the point:
  // a session stripped of a contraindicated movement used to be attributed to
  // whatever recovery rule happened to fire alongside it, or to no rule at all.
  // It demands no intensity step, so what governs and what sets the size of the
  // change are, correctly, two different rules on those days.
  const restrictedMovements = blockedIds.length + proposalBlockedIds.length;
  if (restrictedMovements >= RULES.restrictedMovementsPresent) {
    fire("EVD-R-009", {
      quantity: "restricted_movements",
      value: restrictedMovements,
      restrictions: [...restrictions],
      ...(blockedIds.length ? { inScheduledSession: blockedIds.map((id) => speak(id)) } : {}),
      ...(proposalBlockedIds.length ? { inProposal: proposalBlockedIds.map((id) => speak(id)) } : {})
    });
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
    //
    // `targetFatigue` returns a group only when one of the session's target
    // muscles has a fatigue reading behind it. Where none does there is no
    // number to quote, and `fatigue.value || 0` quoted the reducer's starting
    // value as though it were one: an athlete with no upper-body work in the
    // week was told "target-muscle fatigue 0" for a muscle group nothing in
    // the evidence covers, which is the same fabrication the skipped-workout
    // guard exists to prevent one function away. The gap is already reported
    // in `signalCoverage`; these sentences now match it rather than fill it.
    const fatigueRead = fatigue.group ? `target-muscle fatigue ${fatigue.value}` : null;
    const noReading = `this session's target muscles carry no load from the last week`;
    reason.push(
      intensityUnstatedBlockedARule
        ? `The session is unchanged, but not because the evidence was clear: readiness ${readiness}${fatigueRead ? ` and ${fatigueRead}` : ``} called for a lower intensity that could not be applied. See limits.`
        : readinessKnown
          ? fatigueRead
            ? `Readiness ${readiness} and ${fatigueRead} are both within range, so the session runs as planned.`
            : `Readiness ${readiness} is within range and ${noReading}, so the session runs as planned.`
          : fatigueRead
            ? `Target-muscle fatigue ${fatigue.value} and recent load leave nothing to change, so the session runs as planned.`
            : `Recent load leaves nothing to change and ${noReading}, so the session runs as planned.`
    );
  }

  const coverage = normalizeCoverage(state.signalCoverage);
  // Skipped when readiness went unscored: that limit already names the same
  // missing signals and says confidence dropped. Two sentences for one gap is
  // the noise this file has been cutting all evening.
  if (coverage.recovery.missing.length > 0 && readinessKnown) {
    // `limits` is prose, and prose reaches the athlete. The coverage keys are
    // field names — "No hrv, restingHeartRate, stress signal was available" is
    // both ungrammatical and written in an identifier nobody outside this repo
    // has seen. `signalCoverage` keeps the machine-readable form; this sentence
    // says the same thing in words.
    //
    // What it does not say any more is what the confidence *would have been*.
    // It used to end "so confidence is held lower than it would be with them",
    // which is a counterfactual this engine never computes and which is false
    // in reachable cases: a vendor composite with all four raw signals absent
    // scores `high`, and so does sleep + HRV + resting heart rate with stress
    // missing — `high` is the ceiling, so nothing was held lower. It is also
    // false at `medium` whenever the shortfall is the recent-session count
    // rather than the signals, because supplying them changes nothing.
    // Measured on 2026-08-08, harness scenario 35 and one probe beside it.
    //
    // So the sentence now states what happened — the reading did not arrive and
    // was left out — and lets `confidence` speak for itself. Under-claiming
    // here is the safe direction: a gap the athlete is shown but told nothing
    // about costs them nothing, and a deduction announced that did not happen
    // is the engine describing its own workings wrongly.
    limits.push(
      `${listSignals(coverage.recovery.missing)} for today. What did not arrive was left out of ` +
        `the recovery score rather than filled in, and the confidence figure covers only what did.`
    );
  }
  if (coverage.training.missing.length > 0) {
    limits.push(
      `Some sessions in the last 7 days arrived without a load figure, ` +
        `so the muscle-fatigue picture covers part of the week rather than all of it.`
    );
  }

  // The acute:chronic ratio is the one number here that can look authoritative
  // while resting on almost nothing, because a thin chronic window still divides
  // cleanly. Caught in the field: a ratio of 0.17 computed from a single session,
  // which reads as severe detraining and meant only that the evidence was one day
  // deep. The caveat ships with the ratio rather than being left for the caller
  // to work out.
  // Both of these fire together on any short history, and read as two paragraphs
  // saying one thing: the ratio is early. Said as one sentence with the second
  // fact as a clause, because a reader who is given ninety words about a number
  // that was never the point stops reading the ones that were.
  const acwrCoverage = state.acwrCoverage;
  const thinHistory = acwrCoverage && !acwrCoverage.sufficientHistory;
  const againstTarget = acwrCoverage && acwrCoverage.chronicBasis === "baseline_floor";
  if (thinHistory) {
    limits.push(
      `The acute:chronic ratio ${state.acuteChronicWorkloadRatio} rests on ` +
        `${count(acwrCoverage.historyDays, "day")} of history ` +
        `(${count(acwrCoverage.sessionsInWindow, "session")}), against a ` +
        `${acwrCoverage.chronicWindowDays}-day window` +
        (againstTarget ? `, and is measured against an assumed weekly target rather than a baseline of your own` : ``) +
        `. Treat it as provisional until a few more weeks are in.`
    );
  } else if (againstTarget) {
    limits.push(
      "Chronic load so far sits below the assumed weekly target, so the ratio is measured against that " +
        "target rather than against a baseline of your own, which has not built up yet."
    );
  }

  // Per-session intensity distribution is carried, not consumed. Saying so is
  // the point: a caller who supplied zone data deserves to know the decision
  // did not weigh it, rather than assuming it did. No rule reads these values —
  // inventing a threshold from one athlete's sessions is how an engine gets
  // fitted to a single person.
  // A maximum heart rate seeded from 220-age is an assumption, not a
  // measurement, and every heart-rate-derived load figure in the evidence is
  // scaled against it. The flag has been parsed since the Strava export reader
  // was written and has never been said out loud: the athlete sees load numbers
  // and a decision drawn from them with no way to know what the ceiling was.
  // Nothing is recomputed or discounted here — the reading is used as supplied,
  // and the assumption travels beside it.
  const ageEstimatedSessions = rpeBasisCounts?.athlete_max_hr_age_estimate || 0;
  if (ageEstimatedSessions > 0) {
    limits.push(
      `The maximum heart rate behind ${count(ageEstimatedSessions, "session")} came from the source as an age estimate (220 minus age), not a measured maximum. ` +
        `Heart-rate-derived load is scaled against that ceiling, so those figures — and this decision, where it rests on them — inherit the estimate. A measured maximum, set in the source app, would sharpen them.`
    );
  }

  const distributions = intensityDistributions || [];
  if (distributions.length > 0) {
    const sources = [...new Set(distributions.map((entry) => entry.boundarySource).filter(Boolean))];
    limits.push(
      `${distributions.length} sessions carry a heart-rate zone distribution (boundary source: ${sources.join(", ") || "unlabelled"}). ` +
        `They are kept as evidence, and no rule reads them yet: thresholds are not drawn from a single athlete's sessions.`
    );
  }

  // What the decision stands on.
  //
  // This is the field that separates Evidra from a model that read the same
  // numbers and wrote a fluent paragraph. It names the rule that governs the
  // decision, the reading that triggered it, the threshold it was compared
  // against, and — the part that is easy to leave out and most worth keeping —
  // whether that threshold rests on published work or on a score Evidra
  // computes itself.
  //
  // Seven of the nine rules come back as `basis: "internal_composite"` with
  // `evidence: { studyDesign: "none", recommendationStrength:
  // "internal_heuristic" }` and
  // no sources. That is the correct output, not a gap: six of those thresholds
  // cut a readiness or fatigue score built from weights we chose, and no
  // publication has ever used those scores; the seventh is EVD-R-009, whose
  // threshold is definitional rather than empirical and which records in its own
  // limitations that `internal_composite` is the nearest value and not an exact
  // one. The two that are externally defined
  // (acute:chronic ratio, detraining) carry their citations and, for the ratio,
  // the published objections to it. A reader can therefore tell the difference
  // between the parts of this engine that rest on literature and the parts that
  // rest on our judgement, which is not a distinction most systems expose at
  // all.
  const decisionBasis = buildDecisionBasis({ engineVersion: ENGINE_VERSION, fired });

  const result = {
    evidence,
    state: stateSummary,
    decision: { type, intent },
    action: { from, to: changed.length > 0 ? to : from, changed },
    reason,
    decisionBasis,
    confidence: state.confidence || "low",
    signalCoverage: coverage,
    ...(proposal ? { proposal } : {}),
    limits
  };

  assertValidDecision(result);
  return result;
}

export { RULES };
