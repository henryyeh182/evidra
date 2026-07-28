import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayInTimezone, todayInTimezone } from "../src/dates.js";

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
