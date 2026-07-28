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
    // named a zone; if it cannot be read, say so rather than guess.
    throw new Error(`Unknown timezone: ${zone}`);
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
