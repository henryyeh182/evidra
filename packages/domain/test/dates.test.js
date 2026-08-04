// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayInTimezone, isCalendarDay, todayInTimezone } from "../src/dates.js";

test("a training day is the local calendar day, not the UTC one", () => {
  // 06:30 in Taipei on the 24th is still the 23rd in UTC. Reading a morning
  // session against the UTC day scores it on yesterday's sleep and HRV.
  const beforeMidnightUtc = new Date("2026-07-23T22:30:00Z");

  assert.equal(calendarDayInTimezone(beforeMidnightUtc, "Asia/Taipei"), "2026-07-24");
  assert.equal(calendarDayInTimezone(beforeMidnightUtc, "UTC"), "2026-07-23");
  assert.equal(calendarDayInTimezone(beforeMidnightUtc, "America/Los_Angeles"), "2026-07-23");
});

test("the same instant is one day earlier where the day has not started yet", () => {
  const morningUtc = new Date("2026-07-24T02:00:00Z");

  assert.equal(calendarDayInTimezone(morningUtc, "Asia/Taipei"), "2026-07-24");
  assert.equal(calendarDayInTimezone(morningUtc, "America/Los_Angeles"), "2026-07-23");
});

test("timestamps are accepted as strings, the form evidence arrives in", () => {
  assert.equal(calendarDayInTimezone("2026-07-22T07:30:00+08:00", "Asia/Taipei"), "2026-07-22");
});

test("no timezone means UTC, an unreadable one is an error rather than a guess", () => {
  assert.equal(calendarDayInTimezone("2026-07-23T22:30:00Z"), "2026-07-23");
  assert.throws(() => calendarDayInTimezone("2026-07-23T22:30:00Z", "Mars/Olympus"), /Unknown timezone/);
  assert.throws(() => calendarDayInTimezone("not a date", "UTC"), /Invalid instant/);
});

test("today takes an injectable clock so callers stay deterministic", () => {
  assert.equal(todayInTimezone("Asia/Taipei", new Date("2026-07-23T22:30:00Z")), "2026-07-24");
});

test("today with no clock given tracks the real calendar", () => {
  // The regression this guards: a date literal frozen into the source. Any
  // fixed default fails here the day after it is written.
  const now = new Date();
  assert.equal(todayInTimezone("UTC"), now.toISOString().slice(0, 10));
});

test("a calendar day is recognised, and the ways agents write dates are not", () => {
  // The gate that keeps `Invalid time value` out of the load curve. A leading
  // calendar day is enough, so a full ISO instant stays acceptable — narrowing
  // that would change which day existing callers get, not fix a fault.
  for (const value of ["2026-08-01", "2026-08-01T13:00:00+08:00", "2024-02-29"]) {
    assert.equal(isCalendarDay(value), true, `${value} is a day`);
  }

  for (const value of ["today", "now", "2026-8-1", "08/01/2026", "Aug 1, 2026", "", null, undefined, 20260801]) {
    assert.equal(isCalendarDay(value), false, `${JSON.stringify(value)} is not a day`);
  }

  // Days the calendar does not have: Date rolls these forward rather than
  // failing, so they have to be caught by the round trip.
  for (const value of ["2026-08-32", "2026-02-30", "2026-13-01", "2025-02-29"]) {
    assert.equal(isCalendarDay(value), false, `${value} is not on the calendar`);
  }
});
