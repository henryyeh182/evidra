// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { createHash } from "node:crypto";

import { RELEASE_IDENTITY } from "../../release/src/index.js";
import { calendarDayInTimezone } from "../../domain/src/dates.js";

function timezoneOffsetMs(instantMs, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - instantMs;
}

function endOfLocalDay(asOf, timezone) {
  const day = calendarDayInTimezone(asOf, timezone);
  const wallMs = Date.parse(`${day}T23:59:59.999Z`);
  let instantMs = wallMs;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instantMs = wallMs - timezoneOffsetMs(instantMs, timezone);
  }
  return instantMs;
}

function datesIn(context, asOf, timezone) {
  const cutoff = endOfLocalDay(asOf, timezone);
  return [
    ...(context.workouts || []).map((item) => item.startedAt),
    ...(context.healthMetrics || []).map((item) => item.recordedAt),
    ...(context.vendorAssessments || []).map((item) => item.recordedAt)
  ].filter((value) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time <= cutoff;
  }).sort();
}

export function buildDecisionContinuity({ userId, date, timezone, state, context }) {
  const dates = datesIn(context, date, timezone);
  const stateId = `state_${createHash("sha256")
    .update(JSON.stringify({ userId, date, state }))
    .digest("hex")
    .slice(0, 24)}`;

  return {
    stateId,
    evidenceWindow: {
      asOf: date,
      earliest: dates[0] || null,
      latest: dates.at(-1) || null
    },
    runtimeIdentity: RELEASE_IDENTITY
  };
}

export function buildTodayBrief({ userId, date, decision, state, context, provenance }) {
  const basis = decision.decisionBasis || {};
  const governing = basis.governingRule;
  return {
    userId,
    date,
    evidence: {
      stateId: provenance.stateId,
      window: provenance.evidenceWindow,
      coverage: decision.signalCoverage,
      sources: [...new Set([
        ...(context.healthMetrics || []).map((item) => item.source),
        ...(context.vendorAssessments || []).map((item) => item.source),
        ...(context.workouts || []).map((item) => item.source)
      ].filter(Boolean))].sort()
    },
    state: {
      readinessScore: state.readinessScore,
      recoveryScore: state.recoveryScore,
      fatigueScore: state.fatigueScore
    },
    decision: decision.decision,
    action: decision.action,
    reason: decision.reason,
    confidence: decision.confidence,
    trace: {
      engineVersion: basis.engineVersion || null,
      libraryVersion: basis.libraryVersion || null,
      releaseVersion: basis.releaseVersion || null,
      governingRule: governing ? {
        ruleId: governing.ruleId,
        title: governing.title,
        measured: governing.measured || null,
        thresholds: governing.thresholds || []
      } : null,
      appliedRules: (basis.appliedRules || []).map((rule) => ({
        ruleId: rule.ruleId,
        applied: rule.applied
      }))
    }
  };
}
