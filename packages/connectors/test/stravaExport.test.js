// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  parseStravaExport,
  parseStravaActivitiesCsv,
  parseStravaPreferencesCsv,
  stravaExportDateToIso,
  normalizeStravaExport,
  describeStravaExportCoverage
} from "../src/providers/strava/index.js";
import { VENDOR_SCHEMAS, evidenceToUserContext } from "../../evidence/src/index.js";
import * as dates from "../../domain/src/dates.js";
import { generateSemanticFitnessState } from "../../semantic-engine/src/index.js";
import { decideSession } from "../../decision-engine/src/index.js";

const FIXTURE = fileURLToPath(new URL("../../../data/fixtures/strava/export", import.meta.url));
// The export's max-heart-rate default is age-derived, so the flag only means
// anything against a fixed clock.
const AS_OF = new Date("2026-07-28T00:00:00Z");

const parsed = await parseStravaExport(FIXTURE, { asOf: AS_OF });
const byId = Object.fromEntries(parsed.activities.map((a) => [a.activityId, a]));
const events = normalizeStravaExport(parsed);
const eventById = Object.fromEntries(events.map((e) => [e.sourceRecordId, e]));

// The same archive read a second time, this time opening the FIT files to
// recover each session's UTC offset.
const located = await parseStravaExport(FIXTURE, { asOf: AS_OF, readLocalTimezone: true });
const locatedById = Object.fromEntries(located.activities.map((a) => [a.activityId, a]));
const locatedEvents = Object.fromEntries(
  normalizeStravaExport(located).map((e) => [e.sourceRecordId, e])
);

// --- the duplicate-header trap -------------------------------------------

test("duplicated header names resolve to the metric block, not the localized one", () => {
  // `Distance` appears at column 6 (7.40, kilometres per Measurement
  // Preference) and column 17 (7400.0 metres). Reading by name is a coin flip.
  assert.equal(byId["1000000002"].distanceMeters, 7400);
  assert.equal(byId["1000000001"].distanceMeters, 8100);

  // `Commute` is the string "true" at column 9 and 1.0 at column 50.
  assert.equal(byId["1000000003"].commute, true);
  assert.equal(byId["1000000001"].commute, false);

  // `Elapsed Time` and `Moving Time` are distinct; the hike moved for less
  // time than it ran.
  assert.equal(byId["1000000002"].elapsedSeconds, 6500);
  assert.equal(byId["1000000002"].movingSeconds, 6300);
});

test("a column shift is refused rather than silently mis-read", async () => {
  const csv = await readFile(`${FIXTURE}/activities.csv`, "utf8");
  const [header, ...body] = csv.split("\n");
  const cells = header.split(",");
  [cells[16], cells[17]] = [cells[17], cells[16]];

  assert.throws(
    () => parseStravaActivitiesCsv([cells.join(","), ...body].join("\n")),
    /layout changed: column 16/
  );
});

// --- the UTC-without-offset trap -----------------------------------------

test("Activity Date is read as UTC, not as the host's local time", () => {
  assert.equal(stravaExportDateToIso("Jul 26, 2026, 1:45:16 AM"), "2026-07-26T01:45:16Z");
  assert.equal(stravaExportDateToIso("Jul 25, 2026, 10:56:26 AM"), "2026-07-25T10:56:26Z");
  assert.equal(stravaExportDateToIso("Jul 20, 2026, 12:15:00 PM"), "2026-07-20T12:15:00Z");
  // Midnight is the hour a 12-hour clock gets wrong.
  assert.equal(stravaExportDateToIso("Jan 1, 2026, 12:30:00 AM"), "2026-01-01T00:30:00Z");
  assert.equal(stravaExportDateToIso("not a date"), null);
});

test("the same instant is produced whatever timezone the process runs in", () => {
  const script =
    "const { stravaExportDateToIso } = await import(process.argv[1]);" +
    "process.stdout.write(stravaExportDateToIso('Jul 26, 2026, 1:45:16 AM'));";
  const module = fileURLToPath(new URL("../src/providers/strava/parseExport.js", import.meta.url));

  const run = (tz) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", script, module], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8"
    });

  assert.equal(run("Asia/Taipei"), "2026-07-26T01:45:16Z");
  assert.equal(run("America/Los_Angeles"), "2026-07-26T01:45:16Z");
});

test("without the FIT files no calendar day is claimed, because the CSVs never say", () => {
  for (const activity of parsed.activities) assert.equal(activity.timezoneKnown, false);
  for (const event of events) {
    assert.equal(event.metadata.timezoneKnown, false);
    assert.ok(event.startedAt.endsWith("Z"), "an instant, not a local time");
  }
  assert.ok(describeStravaExportCoverage(parsed).missing.includes("localTimezone"));
});

// --- recovering the offset from the FIT files -----------------------------

test("the FIT file supplies the offset the CSV withholds, and the training day changes", () => {
  // UTC says 2026-07-23T22:30:05. The athlete was at +08:00, so the session
  // happened on the morning of the 24th — which is also why Strava named it
  // "Morning Hike" while the CSV column reads 10:30 PM.
  const hike = locatedEvents["1000000002"];
  assert.equal(hike.metadata.startedAtUtc, "2026-07-23T22:30:05Z");
  assert.equal(hike.startedAt, "2026-07-24T06:30:05+08:00");
  assert.equal(hike.metadata.utcOffsetSeconds, 8 * 3600);
  assert.equal(hike.metadata.timezoneKnown, true);
  assert.notEqual(
    hike.startedAt.slice(0, 10),
    hike.metadata.startedAtUtc.slice(0, 10),
    "the UTC day and the training day are genuinely different days"
  );
});

test("offsets are per-activity, because athletes travel", () => {
  assert.equal(locatedById["1000000001"].utcOffset, "+08:00");
  // Same athlete, same export, seven hours the other way.
  assert.equal(locatedById["1000000005"].utcOffset, "-07:00");
  assert.equal(locatedEvents["1000000005"].startedAt, "2026-07-24T19:10:33-07:00");
  assert.equal(locatedEvents["1000000005"].metadata.startedAtUtc, "2026-07-25T02:10:33Z");
});

test("an unrecorded local_timestamp reads as absent, not as a date in 2125", () => {
  // FIT writes 0xFFFFFFFF for a field that was never filled. Added to the FIT
  // epoch that is a plausible-looking number, which is exactly what makes it
  // dangerous.
  const ride = locatedById["1000000003"];
  assert.equal(ride.timezoneKnown, false);
  assert.equal(ride.utcOffsetSeconds, undefined);
  assert.equal(locatedEvents["1000000003"].startedAt, "2026-07-21T01:05:40Z");
  assert.equal(locatedEvents["1000000003"].metadata.utcOffsetSeconds, null);
});

test("a pruned FIT file leaves that one activity unplaced, not the whole import", () => {
  assert.equal(locatedById["1000000004"].timezoneKnown, false);
  assert.equal(locatedById["1000000001"].timezoneKnown, true, "its neighbours are unaffected");

  const coverage = describeStravaExportCoverage(located);
  assert.equal(coverage.activitiesWithLocalOffset, 3);
  assert.deepEqual(coverage.partial, ["localTimezone"], "some placed, some not — said plainly");
  assert.ok(!coverage.usable.includes("localTimezone"));
  assert.ok(!coverage.missing.includes("localTimezone"));
});

test("reading the FIT files changes nothing but the offset", () => {
  for (const id of Object.keys(eventById)) {
    const before = eventById[id];
    const after = locatedEvents[id];
    assert.equal(after.trainingLoad, before.trainingLoad);
    assert.equal(after.rpe, before.rpe);
    assert.equal(after.durationMinutes, before.durationMinutes);
    assert.equal(after.metadata.startedAtUtc, before.startedAt);
  }
});

test("a non-FIT file is refused rather than decoded into a plausible number", async () => {
  const { readFitLocalOffset, formatUtcOffset } = await import("../src/providers/strava/index.js");
  assert.throws(() => readFitLocalOffset(Buffer.alloc(64)), /Not a FIT file/);
  assert.equal(formatUtcOffset(8 * 3600), "+08:00");
  assert.equal(formatUtcOffset(-7 * 3600), "-07:00");
  assert.equal(formatUtcOffset(5.5 * 3600), "+05:30", "not every offset is a whole hour");
  assert.equal(formatUtcOffset(0), "Z");
});

test("the upload id in Filename is kept apart from Activity ID", () => {
  assert.equal(byId["1000000001"].activityId, "1000000001");
  assert.equal(byId["1000000001"].uploadId, "2000000001");
});

// --- registry <-> parser --------------------------------------------------

test("every column the registry declares is the column the file actually has", async () => {
  const csv = await readFile(`${FIXTURE}/activities.csv`, "utf8");
  const header = csv.split("\n")[0].split(",");

  for (const signal of VENDOR_SCHEMAS.strava_export.signals) {
    assert.equal(
      header[signal.column],
      signal.from,
      `registry maps column ${signal.column} to "${signal.from}"`
    );
  }
});

test("the canonical signals the registry names for Strava all exist", async () => {
  const { CANONICAL_SIGNALS } = await import("../../evidence/src/index.js");
  for (const vendor of ["strava", "strava_export"]) {
    for (const signal of VENDOR_SCHEMAS[vendor].signals) {
      assert.ok(CANONICAL_SIGNALS[signal.to], `${signal.to} must be a canonical signal`);
    }
  }
});

// --- load: what survives, and what it rests on ---------------------------

test("Relative Effort carries the load; FTP-relative TSS rides along in metadata", () => {
  const run = eventById["1000000001"];
  assert.equal(run.trainingLoad, 58, "Relative Effort, the same quantity the API calls suffer_score");
  assert.equal(run.metadata.loadSource, "relative_effort");
  assert.equal(run.metadata.trainingLoadTss, 38);
  assert.equal(run.metadata.intensityFactorPercent, 70);
  assert.equal(run.metadata.ftpWattsAtImport, 240, "TSS means nothing without the FTP it is relative to");
});

test("a session without power reports absent load columns as absent, never as zero", () => {
  const hike = byId["1000000002"];
  assert.equal(hike.trainingLoad, null);
  assert.equal(hike.intensityFactor, null);
  assert.equal(hike.weightedAveragePower, null);
  // ...and still produces a load, because Relative Effort does not need power.
  assert.equal(eventById["1000000002"].trainingLoad, 35);
  assert.equal(eventById["1000000002"].metadata.loadSource, "relative_effort");
});

test("with neither power nor heart rate, RPE and load are absent rather than invented", () => {
  const strength = eventById["1000000004"];
  assert.equal(strength.type, "strength");
  // The activity type says what it was, not how hard it felt.
  assert.equal(strength.rpe, null);
  assert.equal(strength.metadata.rpeBasis, "unavailable");
  // Absent is not the same as estimated, and the metadata must not blur them.
  assert.equal(strength.metadata.rpeEstimated, false);
  // Duration alone is not a load, so nothing is scaled into one.
  assert.equal(strength.trainingLoad, null);
  assert.equal(strength.metadata.loadSource, "unavailable");
});

test("a reported RPE outranks anything inferred from heart rate", () => {
  assert.equal(eventById["1000000005"].rpe, 7);
  assert.equal(eventById["1000000005"].metadata.rpeBasis, "reported");
  assert.equal(eventById["1000000005"].metadata.rpeEstimated, false);
});

test("per-activity steps never masquerade as a daily step count", () => {
  assert.equal(eventById["1000000002"].metadata.activitySteps, 11200);
  // The canonical daily `steps` signal is deliberately not claimed here.
  assert.ok(!VENDOR_SCHEMAS.strava_export.signals.some((s) => s.to === "steps"));
});

// --- anchors --------------------------------------------------------------

test("an unedited 220-age maximum heart rate is flagged as an estimate", () => {
  assert.equal(parsed.anchors.maxHeartRateBpm, 182);
  assert.equal(parsed.anchors.maxHeartRateIsAgeEstimate, true, "220 - 38 for a 1988 athlete in 2026");
  assert.equal(parsed.anchors.functionalThresholdPowerWatts, 240);
  assert.equal(parsed.anchors.weightKg, 72);
  // Without this the export's leading distance columns have no unit at all.
  assert.equal(parsed.anchors.measurementPreference, "Metric");

  assert.equal(eventById["1000000001"].metadata.rpeBasis, "athlete_max_hr_age_estimate");
});

test("a measured maximum heart rate is not flagged as an estimate", () => {
  const csv =
    "Date of Birth,Weight,Functional Threshold Power,Maximum Heartrate,Athlete Type,Measurement Preference\n" +
    '"Mar 12, 1988",72.0 kg,240 W,194,Runner,Metric\n';
  const anchors = parseStravaPreferencesCsv(csv, { asOf: AS_OF });
  assert.equal(anchors.maxHeartRateBpm, 194);
  assert.equal(anchors.maxHeartRateIsAgeEstimate, false);
});

// --- structured strength data --------------------------------------------

test("per-set rows attach to the activity they belong to", () => {
  const sets = eventById["1000000004"].metadata.sets;
  assert.equal(sets.length, 6);
  assert.equal(sets[0].exerciseName, "Barbell Back Squat");
  assert.equal(sets[0].repetitions, 6);
  assert.equal(sets[0].weightKg, 90);
  assert.equal(sets[3].supersetId, "1");
  // A bodyweight hold has no load and no reps — absent, not zero.
  assert.equal(sets[5].exerciseName, "Plank");
  assert.equal(sets[5].repetitions, null);
  assert.equal(sets[5].weightKg, null);

  for (const event of events) {
    if (event.sourceRecordId !== "1000000004") assert.equal(event.metadata.sets.length, 0);
  }
});

// --- coverage and the decision it supports -------------------------------

test("coverage names what this export can answer before it names what it cannot", () => {
  const coverage = describeStravaExportCoverage(parsed);
  assert.equal(coverage.activities, 5);
  assert.deepEqual(coverage.usable, [
    "sessionRelativeEffort",
    "sessionTrainingLoadTss",
    "sessionIntensityFactor",
    "sessionHeartRate",
    "exerciseSets"
  ]);
  assert.ok(coverage.missing.includes("sleep"));
  assert.ok(coverage.missing.includes("hrv"));
  assert.equal(coverage.ftpWatts, 240);
});

test("a Strava-export-only athlete lands on the right training day once the FIT files are read", () => {
  const { calendarDayInTimezone } = dates;
  const hike = locatedEvents["1000000002"];

  // The offset is a fact about the session; the timezone is a fact about the
  // athlete. Both routes agree here, which is the point — the recovered
  // offset is what makes them agree.
  assert.equal(hike.startedAt.slice(0, 10), "2026-07-24");
  assert.equal(calendarDayInTimezone(hike.metadata.startedAtUtc, "Asia/Taipei"), "2026-07-24");
  assert.equal(calendarDayInTimezone(hike.metadata.startedAtUtc, "UTC"), "2026-07-23");
});

test("a Strava-export-only athlete still gets a decision, and it explains itself", () => {
  const evidence = {
    profile: { timezone: "Asia/Taipei" },
    goals: [{ type: "half_marathon", priority: 1 }],
    constraints: { availableMinutes: 60 },
    workouts: events.map((event) => ({
      id: event.id,
      type: event.type,
      name: event.name,
      startedAt: event.startedAt,
      durationMinutes: event.durationMinutes,
      rpe: event.rpe,
      trainingLoad: event.trainingLoad,
      muscleGroups: event.muscleGroups,
      source: event.source
    })),
    healthMetrics: []
  };

  const context = evidenceToUserContext(evidence, { userId: "strava-only" });
  const state = generateSemanticFitnessState(context, { date: "2026-07-27", timezone: "Asia/Taipei" });
  const decision = decideSession({
    scheduledSession: {
      focus: "Tempo Run",
      type: "run",
      durationMinutes: 45,
      intensity: "high",
      targetMuscleGroups: ["legs"],
      exercises: ["Tempo Run"]
    },
    state
  });

  // A Strava export carries training and no physiology, so readiness is not
  // scored — and the point of this test is that the decision lands anyway, on
  // load. It used to assert a finite readiness, which only passed because an
  // absent recovery signal was being filled in with 50 and then decided on.
  assert.equal(state.readinessScore, null, "no recovery signal, so no readiness score");
  assert.ok(state.signalCoverage.recovery.missing.includes("sleep"), "the gap is reported, not papered over");
  assert.ok(
    decision.limits.some((line) => line.includes("Readiness was not scored today")),
    "and the decision says which rules therefore sat out"
  );
  assert.ok(decision.decision.type);
  assert.ok(decision.reason.length > 0);
  assert.ok(["low", "medium", "high"].includes(decision.confidence));
});

// --- absent files ---------------------------------------------------------

test("a partial export is read for what it has", async () => {
  const activitiesOnly = await parseStravaExport(FIXTURE, { asOf: AS_OF });
  assert.equal(activitiesOnly.files["general_preferences.csv"], true);

  await assert.rejects(
    () => parseStravaExport(fileURLToPath(new URL("../../../data/fixtures/strava", import.meta.url))),
    /Not a Strava export/
  );
});
