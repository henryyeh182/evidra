// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * A training day is a calendar day where the athlete lives, not a UTC instant.
 *
 * At 07:00 in Asia/Taipei the UTC day is still yesterday, so a default date
 * taken from `new Date().toISOString()` reads a morning session against the
 * previous day's sleep and HRV. Every date this system defaults on its own
 * behalf resolves through here (engineering principle P5: the server parses
 * dates and timezones, the caller does not have to).
 */

/**
 * The calendar day an instant falls on, in the given timezone.
 *
 * @param {Date|string|number} instant
 * @param {string} [timezone] IANA name; UTC when absent
 * @returns {string} YYYY-MM-DD
 */
export function calendarDayInTimezone(instant, timezone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid instant: ${String(instant)}`);
  }

  const zone = timezone || "UTC";
  let formatter;
  try {
    // en-CA renders as YYYY-MM-DD, which is the calendar-day form used
    // throughout the evidence contract.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
  } catch {
    // Falling back to UTC would hand back a confidently wrong day. The caller
    // named a zone; if it cannot be read, say so rather than guess — and name
    // the form that works, since the usual mistakes ("Taipei", "GMT+8") are a
    // spelling away from a zone that does.
    throw new Error(`Unknown timezone: ${zone}. Expected an IANA zone name, e.g. Asia/Taipei.`);
  }

  return formatter.format(date);
}

/**
 * Today, where the athlete is.
 *
 * @param {string} [timezone] IANA name; UTC when absent
 * @param {Date} [now] injectable clock, so callers stay testable
 * @returns {string} YYYY-MM-DD
 */
export function todayInTimezone(timezone, now = new Date()) {
  return calendarDayInTimezone(now, timezone);
}

/**
 * Whether a caller-supplied value names a day this system can reason about.
 *
 * Agents write dates the way people say them — "today", "2026-8-1",
 * "Aug 1, 2026" — and every one of those used to reach `new Date()` deep in the
 * load curve and throw `Invalid time value`, which surfaced to the user as
 * "Failed to call tool". Checking here lets the caller be told what a day looks
 * like while it can still fix the argument.
 *
 * A leading calendar day is enough, so a full ISO instant keeps working exactly
 * as it did — the day is what the engines read, and narrowing that now would
 * change answers rather than fix a fault.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCalendarDay(value) {
  if (typeof value !== "string") return false;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  // Rejects days the calendar does not have: 2026-02-30 rolls forward to March
  // rather than failing, so the round trip is what catches it.
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
