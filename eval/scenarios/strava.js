/**
 * Strava bulk-export source-schema simulation scenarios.
 *
 * Like the Garmin, Apple Health and Google Health sets, these exist to verify
 * **schema comprehension** — reading Strava's export dialect and landing it in
 * the canonical vocabulary — not to tune anything. No check asserts what a
 * readiness score ought to be, and the physiological values carried through are
 * freight rather than ground truth.
 *
 * The axis of variation is the shape of the export:
 *
 *   complete_export        every load column populated, offsets recovered
 *   no_power_sessions      Relative Effort without Training Load or Intensity
 *   timezone_unknown       no FIT files read, including a session that crosses
 *                          a day boundary
 *   column_shift           the header row moved under the positional parser
 *   age_estimated_max_hr   the athlete never edited Strava's 220-age default
 *   strava_only_athlete    no sleep, no HRV, no resting heart rate anywhere
 *
 * Three of these are here because a real export said so. `no_power_sessions` is
 * the shape of 2 of 7 real activities — a hike and a ride with no power meter,
 * where `Training Load` and `Intensity` simply do not exist and Relative Effort
 * is the only load left. `age_estimated_max_hr` is not a hypothetical: the
 * measured athlete's maximum heart rate is exactly 220 - age, so their whole
 * load series rests on a seeded default and the evidence has to say so.
 * `strava_only_athlete` is the whole archive — 39 CSVs, none carrying recovery
 * physiology — and discipline 3 says that athlete still gets a decision.
 *
 * `timezone_unknown` is the one shape that is designed rather than observed.
 * All 7 real activities recovered a +08:00 offset and none crossed a day
 * boundary, so the cross-day session below is a guard against a trap the
 * dialect allows, not a case measured in that file.
 */

const DAY_MS = 86400000;

function shiftDay(asOf, daysAgo) {
  return new Date(new Date(`${asOf}T00:00:00Z`).getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The real 103-column header of `activities.csv`.
 *
 * Verbatim, because the parser asserts against it before reading a value and a
 * scenario built on an invented header would never exercise that assertion.
 * Note the five repeated names — `Elapsed Time`, `Distance`, `Max Heart Rate`,
 * `Relative Effort` and `Commute` each appear twice, with different units.
 */
export const ACTIVITIES_HEADER = [
  "Activity ID", "Activity Date", "Activity Name", "Activity Type", "Activity Description",
  "Elapsed Time", "Distance", "Max Heart Rate", "Relative Effort", "Commute",
  "Activity Private Note", "Activity Gear", "Filename", "Athlete Weight", "Bike Weight",
  "Elapsed Time", "Moving Time", "Distance", "Max Speed", "Average Speed", "Elevation Gain",
  "Elevation Loss", "Elevation Low", "Elevation High", "Max Grade", "Average Grade",
  "Average Positive Grade", "Average Negative Grade", "Max Cadence", "Average Cadence",
  "Max Heart Rate", "Average Heart Rate", "Max Watts", "Average Watts", "Calories",
  "Max Temperature", "Average Temperature", "Relative Effort", "Total Work", "Number of Runs",
  "Uphill Time", "Downhill Time", "Other Time", "Perceived Exertion", "Type", "Start Time",
  "Weighted Average Power", "Power Count", "Prefer Perceived Exertion",
  "Perceived Relative Effort", "Commute", "Total Weight Lifted", "From Upload",
  "Grade Adjusted Distance", "Weather Observation Time", "Weather Condition",
  "Weather Temperature", "Apparent Temperature", "Dewpoint", "Humidity", "Weather Pressure",
  "Wind Speed", "Wind Gust", "Wind Bearing", "Precipitation Intensity", "Sunrise Time",
  "Sunset Time", "Moon Phase", "Bike", "Gear", "Precipitation Probability",
  "Precipitation Type", "Cloud Cover", "Weather Visibility", "UV Index", "Weather Ozone",
  "Jump Count", "Total Grit", "Average Flow", "Flagged", "Average Elapsed Speed",
  "Dirt Distance", "Newly Explored Distance", "Newly Explored Dirt Distance", "Activity Count",
  "Total Steps", "Carbon Saved", "Pool Length", "Training Load", "Intensity",
  "Average Grade Adjusted Pace", "Timer Time", "Total Cycles", "Recovery", "With Pet",
  "Competition", "Long Run", "For a Cause", "With Kid", "Downhill Distance", "Total Sets",
  "Total Reps", "Media"
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Strava's date spelling, in UTC and carrying no offset: "Jul 26, 2026, 1:45:16 AM". */
export function stravaDate(day, { hour = 10, minute = 30, second = 0 } = {}) {
  const [year, month, date] = day.split("-").map(Number);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  const pad = (value) => String(value).padStart(2, "0");
  return `${MONTH_NAMES[month - 1]} ${date}, ${year}, ${display}:${pad(minute)}:${pad(second)} ${meridiem}`;
}

const quote = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * One row of `activities.csv`, addressed the way the file actually is.
 *
 * The display block (5-9) is filled as well as the metric block, and with the
 * *other* unit, because a parser that reads by name rather than by index would
 * pass a scenario where both spellings agree.
 */
function activityRow({
  id,
  date,
  name,
  type,
  filename,
  elapsedSeconds,
  movingSeconds,
  distanceMeters,
  relativeEffort,
  averageHeartRate,
  maxHeartRate,
  averageWatts = null,
  weightedAveragePower = null,
  trainingLoad = null,
  intensityFactor = null,
  perceivedExertion = null,
  calories = null,
  elevationGainMeters = null,
  activitySteps = null
}) {
  const cells = new Array(ACTIVITIES_HEADER.length).fill("");

  cells[0] = id;
  cells[1] = date;
  cells[2] = name;
  cells[3] = type;
  // The localized display block: same names as 15-17 / 30 / 37 / 50, other units.
  cells[5] = elapsedSeconds;
  cells[6] = (distanceMeters / 1000).toFixed(2);
  cells[7] = maxHeartRate === null ? "" : maxHeartRate.toFixed(1);
  cells[8] = relativeEffort === null ? "" : String(relativeEffort);
  cells[9] = "false";
  cells[12] = filename;
  // The raw metric block, which is what is actually read.
  cells[15] = elapsedSeconds.toFixed(1);
  cells[16] = movingSeconds.toFixed(1);
  cells[17] = distanceMeters.toFixed(1);
  cells[19] = (distanceMeters / movingSeconds).toFixed(3);
  cells[20] = elevationGainMeters === null ? "" : elevationGainMeters.toFixed(1);
  cells[30] = maxHeartRate === null ? "" : maxHeartRate.toFixed(1);
  cells[31] = averageHeartRate === null ? "" : averageHeartRate.toFixed(1);
  cells[33] = averageWatts === null ? "" : averageWatts.toFixed(1);
  cells[34] = calories === null ? "" : calories.toFixed(1);
  cells[37] = relativeEffort === null ? "" : relativeEffort.toFixed(1);
  cells[43] = perceivedExertion === null ? "" : String(perceivedExertion);
  cells[46] = weightedAveragePower === null ? "" : weightedAveragePower.toFixed(1);
  cells[50] = "0.0";
  cells[85] = activitySteps === null ? "" : activitySteps.toFixed(1);
  cells[88] = trainingLoad === null ? "" : trainingLoad.toFixed(1);
  cells[89] = intensityFactor === null ? "" : intensityFactor.toFixed(1);

  return cells.map(quote).join(",");
}

function activitiesCsv(rows, { header = ACTIVITIES_HEADER } = {}) {
  return [header.map(quote).join(","), ...rows].join("\n");
}

/**
 * general_preferences.csv.
 *
 * `maxHeartRate` defaults to a measured-looking value; the age-estimate
 * scenario passes 220 - age instead, which is what the real athlete has.
 */
function preferencesCsv({ maxHeartRate = 186, dateOfBirth = "Jul 7, 1977", ftpWatts = 173 } = {}) {
  const header = [
    "Date of Birth", "Weight", "Functional Threshold Power", "Maximum Heartrate", "Athlete Type",
    "Measurement Preference", "Date Preference", "Chart Preference", "Email Language",
    "Pace Zone Time", "Pace Zone Distance", "Default Leaderboard View"
  ];
  const row = [
    dateOfBirth, "78.0 kg", `${ftpWatts} W`, String(maxHeartRate), "Runner",
    "Metric", "mm/dd/YYYY", "Week", "English", "--:--", "", "All"
  ];
  return [header.map(quote).join(","), row.map(quote).join(",")].join("\n");
}

/** structured_details.csv with a header and no rows — the ordinary case. */
function structuredDetailsCsv() {
  return [
    "Activity ID", "Exercise Name", "Repetitions", "Duration (seconds)", "Weight",
    "Start Time (milliseconds)", "Superset ID", "Rate of Perceived Exertion"
  ].join(",");
}

// --- export shapes ---------------------------------------------------------

/** A run with power: every load column Strava can fill, filled. */
function poweredRun(asOf, daysAgo, id, overrides = {}) {
  const day = shiftDay(asOf, daysAgo);
  return activityRow({
    id,
    date: stravaDate(day, { hour: 11, minute: 42, second: 49 }),
    name: "Evening Run",
    type: "Run",
    filename: `activities/${id}.fit.gz`,
    elapsedSeconds: 2321,
    movingSeconds: 2227,
    distanceMeters: 7204.3,
    relativeEffort: 50,
    averageHeartRate: 136,
    maxHeartRate: 158,
    averageWatts: 105,
    weightedAveragePower: 101,
    trainingLoad: 20,
    intensityFactor: 58,
    calories: 512,
    elevationGainMeters: 41,
    activitySteps: 5620,
    ...overrides
  });
}

function completeExport(asOf) {
  const rows = [];
  for (let index = 0; index < 6; index += 1) {
    rows.push(poweredRun(asOf, index * 3 + 1, `2100000000${index}`));
  }
  return {
    activitiesCsv: activitiesCsv(rows),
    preferencesCsv: preferencesCsv(),
    structuredCsv: structuredDetailsCsv(),
    // What `readLocalTimezone` would have recovered from the FIT files.
    offsetsSeconds: 8 * 3600
  };
}

/**
 * The hike-and-ride shape: heart rate but no power meter.
 *
 * `Training Load` and `Intensity` are not zero here, they are absent — Strava
 * writes nothing in those columns when a session recorded no weighted average
 * power. Relative Effort is what survives, and it is why the connector builds
 * its load series from that column rather than the more precise-looking one.
 */
function noPowerExport(asOf) {
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    const day = shiftDay(asOf, index * 2 + 1);
    rows.push(
      activityRow({
        id: `2200000000${index}`,
        date: stravaDate(day, { hour: 1, minute: 45, second: 16 }),
        name: "Morning Hike",
        type: "Hike",
        filename: `activities/2200000000${index}.fit.gz`,
        elapsedSeconds: 5816,
        movingSeconds: 5626,
        distanceMeters: 5671.4,
        relativeEffort: 30,
        averageHeartRate: 112,
        maxHeartRate: 145,
        averageWatts: 89,
        weightedAveragePower: null,
        trainingLoad: null,
        intensityFactor: null,
        calories: 478,
        elevationGainMeters: 212,
        activitySteps: 9130
      })
    );
  }
  return {
    activitiesCsv: activitiesCsv(rows),
    preferencesCsv: preferencesCsv(),
    structuredCsv: structuredDetailsCsv(),
    offsetsSeconds: 8 * 3600
  };
}

/**
 * The export as it arrives when the FIT files were not read.
 *
 * The last row starts at 23:41 UTC, which in the athlete's +08:00 is 07:41 the
 * next morning. Nothing in the CSV says so. The evidence must therefore keep
 * the instant and say the timezone is unknown, rather than file the session
 * against the UTC day as though that were a training day.
 */
function timezoneUnknownExport(asOf) {
  const rows = [];
  for (let index = 0; index < 4; index += 1) {
    rows.push(poweredRun(asOf, index * 3 + 2, `2300000000${index}`));
  }
  const crossing = shiftDay(asOf, 1);
  rows.push(
    poweredRun(asOf, 1, "23000000099", {
      date: stravaDate(crossing, { hour: 23, minute: 41, second: 5 }),
      name: "Morning Ride",
      type: "Ride"
    })
  );
  return {
    activitiesCsv: activitiesCsv(rows),
    preferencesCsv: preferencesCsv(),
    structuredCsv: structuredDetailsCsv(),
    // The point of this shape: no FIT files were opened.
    offsetsSeconds: null
  };
}

/**
 * The header row moved by one column.
 *
 * Positional parsing has exactly one failure mode, and this is it. Reading on
 * would return kilometres where metres are expected and a display heart rate
 * where a metric one is. The parser must throw instead.
 */
function columnShiftExport(asOf) {
  const shifted = ["Athlete ID", ...ACTIVITIES_HEADER];
  return {
    activitiesCsv: activitiesCsv([poweredRun(asOf, 1, "24000000000")], { header: shifted }),
    preferencesCsv: preferencesCsv(),
    structuredCsv: structuredDetailsCsv(),
    offsetsSeconds: 8 * 3600,
    expectParseError: /layout changed/i
  };
}

/**
 * The athlete never edited Strava's seeded maximum heart rate.
 *
 * 220 - 49 = 171 against a 1977 date of birth, which is exactly what the
 * measured export contains. Every Relative Effort in that file — and so every
 * inferred RPE — rests on it.
 */
function ageEstimatedMaxHrExport(asOf) {
  const base = completeExport(asOf);
  return { ...base, preferencesCsv: preferencesCsv({ maxHeartRate: 171, dateOfBirth: "Jul 7, 1977" }) };
}

/**
 * A Strava-only athlete.
 *
 * There is no sleep, HRV or resting heart rate anywhere in a Strava export —
 * checked across all 39 CSVs of the measured archive. Discipline 3 says this
 * athlete still gets a decision from training load, and that the absence lives
 * in coverage and confidence rather than in the narrative.
 */
function stravaOnlyExport(asOf) {
  const rows = [];
  for (let index = 0; index < 8; index += 1) {
    rows.push(poweredRun(asOf, index + 1, `2600000000${index}`));
  }
  return {
    activitiesCsv: activitiesCsv(rows),
    // No general_preferences.csv either: the athlete's ceiling is unknown, so
    // an RPE may only be inferred against the session's own peak.
    preferencesCsv: null,
    structuredCsv: null,
    offsetsSeconds: 8 * 3600
  };
}

export const STRAVA_EXPORTS = {
  complete: completeExport,
  noPower: noPowerExport,
  timezoneUnknown: timezoneUnknownExport,
  columnShift: columnShiftExport,
  ageEstimatedMaxHr: ageEstimatedMaxHrExport,
  stravaOnly: stravaOnlyExport
};

// --- checks ----------------------------------------------------------------

const workoutsOf = (events) => events.filter((event) => event.kind === "workout");

const everySignalIsLabelledStrava = {
  name: "nothing arrives without saying it came from Strava",
  run: ({ events }) => {
    const wrong = events.filter((event) => event.source !== "strava");
    return wrong.length === 0 || `${wrong.length} events carried source ${wrong[0].source}`;
  }
};

const speaksCanonicalWorkoutTypes = {
  name: "every session lands on a domain workout type, not Strava's",
  run: ({ events, workoutTypes }) => {
    const foreign = [...new Set(workoutsOf(events).map((event) => event.type))].filter(
      (type) => !workoutTypes.includes(type)
    );
    return foreign.length === 0 || `not canonical: ${foreign.join(", ")}`;
  }
};

export const STRAVA_SCENARIOS = [
  {
    id: "complete_export",
    label: "Complete export — every load column Strava can fill, filled",
    purpose:
      "The reference reading. Relative Effort becomes the training load, the FTP-relative numbers stay in metadata where they cannot be mistaken for a series, and the recovered offset makes the calendar day true.",
    build: STRAVA_EXPORTS.complete,
    checks: [
      everySignalIsLabelledStrava,
      speaksCanonicalWorkoutTypes,
      {
        name: "the header assertion actually ran against the real 103-column layout",
        run: ({ parsed }) =>
          parsed.activities.length > 0 || "nothing parsed, so the column map was never exercised"
      },
      {
        name: "Relative Effort is the load, not the FTP-relative Training Load",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no sessions were parsed";
          const wrong = sessions.find((session) => session.metadata.loadSource !== "relative_effort");
          if (wrong) return `loadSource was ${wrong.metadata.loadSource}`;
          const mismatched = sessions.find((session) => session.trainingLoad !== 50);
          return !mismatched || `a Relative Effort of 50 became a load of ${mismatched.trainingLoad}`;
        }
      },
      {
        name: "the FTP-relative numbers survive as metadata, and say what they are relative to",
        run: ({ events }) => {
          const session = workoutsOf(events)[0];
          if (!session) return "no sessions were parsed";
          if (session.metadata.trainingLoadTss !== 20) {
            return `trainingLoadTss was ${session.metadata.trainingLoadTss}`;
          }
          if (session.metadata.intensityFactorPercent !== 58) {
            return `intensityFactorPercent was ${session.metadata.intensityFactorPercent}`;
          }
          return (
            session.metadata.ftpWattsAtImport === 173 ||
            `the FTP those numbers are relative to was recorded as ${session.metadata.ftpWattsAtImport}`
          );
        }
      },
      {
        name: "the recovered offset reaches the evidence, so the calendar day is true",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          const unanchored = sessions.filter((session) => session.metadata.timezoneKnown !== true);
          if (unanchored.length > 0) return `${unanchored.length} sessions did not carry a recovered offset`;
          const zulu = sessions.find((session) => String(session.startedAt).endsWith("Z"));
          return !zulu || `a session with a known offset was still dated ${zulu.startedAt}`;
        }
      },
      {
        name: "the display block's other units never reach the evidence",
        run: ({ events }) => {
          // Column 6 says 7.20 (km) where column 17 says 7204.3 (m). A parser
          // reading by name could take either.
          const wrong = workoutsOf(events).find((session) => session.metadata.distanceMeters !== 7204.3);
          return !wrong || `distance came through as ${wrong.metadata.distanceMeters}, not the metric column`;
        }
      }
    ]
  },
  {
    id: "no_power_sessions",
    label: "No power — Relative Effort without Training Load or Intensity",
    purpose:
      "The shape of 2 of 7 real activities: a hike and a ride with heart rate but no power meter, where Strava leaves Training Load and Intensity empty. Empty is not zero, and Relative Effort is the only load left — which is the whole reason it is the chosen signal.",
    build: STRAVA_EXPORTS.noPower,
    checks: [
      everySignalIsLabelledStrava,
      speaksCanonicalWorkoutTypes,
      {
        name: "a session with no power still carries a training load",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no sessions were parsed";
          const loadless = sessions.filter((session) => session.trainingLoad === null);
          if (loadless.length > 0) return `${loadless.length} of ${sessions.length} sessions carried no load`;
          const wrong = sessions.find((session) => session.metadata.loadSource !== "relative_effort");
          return !wrong || `loadSource was ${wrong.metadata.loadSource}`;
        }
      },
      {
        name: "an absent Training Load stays absent rather than becoming zero",
        run: ({ events }) => {
          const leaked = workoutsOf(events).filter(
            (session) =>
              session.metadata.trainingLoadTss === 0 ||
              session.metadata.intensityFactorPercent === 0 ||
              session.metadata.weightedAveragePower === 0
          );
          if (leaked.length > 0) return `${leaked.length} sessions read an empty power column as 0`;
          const session = workoutsOf(events)[0];
          return (
            session.metadata.trainingLoadTss === null ||
            `trainingLoadTss was ${session.metadata.trainingLoadTss} on a session with no power`
          );
        }
      },
      {
        name: "Hike is a domain type, not passed through as Strava's",
        run: ({ events }) => {
          const wrong = workoutsOf(events).find((session) => session.type !== "walk");
          return !wrong || `Hike became ${wrong.type}`;
        }
      }
    ]
  },
  {
    id: "timezone_unknown",
    label: "Timezone unknown — no FIT files read, and a session that crosses a day",
    purpose:
      "Without the FIT files the CSV cannot say which training day a session belongs to. A session starting 23:41 UTC is the next morning in +08:00, so reading the Z day would file it against the wrong day. The evidence must keep the instant and admit the offset is unknown.",
    build: STRAVA_EXPORTS.timezoneUnknown,
    checks: [
      everySignalIsLabelledStrava,
      {
        name: "every session says its timezone is unknown",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no sessions were parsed";
          const claiming = sessions.filter((session) => session.metadata.timezoneKnown !== false);
          return claiming.length === 0 || `${claiming.length} sessions claimed a timezone the CSV never carried`;
        }
      },
      {
        name: "the timestamp stays an explicit UTC instant, not a bare local-looking one",
        run: ({ events }) => {
          const wrong = workoutsOf(events).find((session) => !String(session.startedAt).endsWith("Z"));
          return !wrong || `a session with no recovered offset was dated ${wrong.startedAt}`;
        }
      },
      {
        name: "the session that crosses a day is still there, with its instant intact",
        run: ({ events }) => {
          const crossing = workoutsOf(events).find((session) => session.sourceRecordId === "23000000099");
          if (!crossing) return "the crossing session was dropped";
          if (!String(crossing.startedAt).includes("T23:41:05")) {
            return `its instant was rewritten to ${crossing.startedAt}`;
          }
          return (
            crossing.metadata.startedAtUtc === crossing.startedAt ||
            "the UTC instant and the reported start disagree"
          );
        }
      },
      {
        name: "the load is unaffected by the missing offset",
        run: ({ events }) => {
          const loadless = workoutsOf(events).filter((session) => session.trainingLoad === null);
          return loadless.length === 0 || `${loadless.length} sessions lost their load along with their timezone`;
        }
      }
    ]
  },
  {
    id: "column_shift",
    label: "Column shift — the header moved under a positional parser",
    purpose:
      "activities.csv is read by index because five header names repeat with different units. That makes a silent column shift the one failure mode, and it would return kilometres labelled as metres. The parser must refuse the file rather than read it wrong.",
    build: STRAVA_EXPORTS.columnShift,
    expectParseError: /layout changed/i,
    checks: [
      {
        name: "a shifted layout is refused, naming the column that moved",
        run: ({ parseError }) => {
          if (!parseError) return "the shifted export parsed without complaint";
          return (
            /column \d+ should be/.test(parseError.message) ||
            `the refusal did not say which column moved: ${parseError.message}`
          );
        }
      },
      {
        name: "the refusal happens before any value is trusted",
        run: ({ events }) =>
          events.length === 0 || `${events.length} events were produced from a file the parser had rejected`
      }
    ]
  },
  {
    id: "age_estimated_max_hr",
    label: "Age-estimated maximum — the athlete never edited Strava's default",
    purpose:
      "220 - 49 = 171 is exactly what the measured export contains. Relative Effort is heart-rate derived, so this athlete's entire load series rests on a 1971 rule of thumb with a 10-20 bpm error bar. An inferred RPE standing on that is weaker evidence than one the athlete typed in, and it has to say which rung it stood on.",
    build: STRAVA_EXPORTS.ageEstimatedMaxHr,
    checks: [
      {
        name: "the seeded default is recognised as an estimate",
        run: ({ parsed }) =>
          parsed.anchors?.maxHeartRateIsAgeEstimate === true ||
          `maxHeartRateIsAgeEstimate was ${parsed.anchors?.maxHeartRateIsAgeEstimate}`
      },
      {
        name: "every inferred RPE says it stood on an age estimate",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length === 0) return "no sessions were parsed";
          const wrong = sessions.find((session) => session.metadata.rpeBasis !== "athlete_max_hr_age_estimate");
          return !wrong || `rpeBasis was ${wrong.metadata.rpeBasis}`;
        }
      },
      {
        name: "an inferred RPE is marked as inferred, never as reported",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          const passedOff = sessions.filter((session) => session.rpe !== null && !session.metadata.rpeEstimated);
          return passedOff.length === 0 || `${passedOff.length} inferred RPEs were not marked as estimates`;
        }
      },
      {
        name: "Strava supplied no Perceived Exertion, so none is invented as reported",
        run: ({ events }) => {
          const claimed = workoutsOf(events).filter((session) => session.metadata.rpeBasis === "reported");
          return claimed.length === 0 || `${claimed.length} sessions claimed an RPE the athlete never typed in`;
        }
      }
    ]
  },
  {
    id: "strava_only_athlete",
    label: "Strava only — no sleep, no HRV, no resting heart rate anywhere",
    purpose:
      "A Strava export carries no recovery physiology at all: checked across all 39 CSVs of the measured archive and found in none. Discipline 3 says this athlete is served, not degraded — a decision still lands from training load, and the absence appears in coverage and confidence rather than in the narrative.",
    build: STRAVA_EXPORTS.stravaOnly,
    checks: [
      everySignalIsLabelledStrava,
      {
        name: "no recovery signal is manufactured from an export that has none",
        run: ({ events }) => {
          const invented = events.filter((event) => event.kind === "health_metric");
          return (
            invented.length === 0 ||
            `${invented.length} health metrics appeared: ${[...new Set(invented.map((e) => e.type))].join(", ")}`
          );
        }
      },
      {
        name: "training load is still delivered for every session",
        run: ({ events }) => {
          const sessions = workoutsOf(events);
          if (sessions.length < 8) return `only ${sessions.length} sessions survived`;
          const loadless = sessions.filter((session) => session.trainingLoad === null);
          return loadless.length === 0 || `${loadless.length} sessions carried no load`;
        }
      },
      {
        name: "coverage reports the missing recovery group rather than staying silent",
        run: ({ state }) => {
          const recovery = state.signalCoverage?.recovery;
          if (!recovery) return "signalCoverage.recovery was absent";
          if (recovery.usable.length > 0) {
            return `recovery claimed ${recovery.usable.join(", ")} from an export that has none`;
          }
          return recovery.missing.length > 0 || "nothing was reported as missing either";
        }
      },
      {
        name: "with no preferences file, an RPE stands on the session's own peak and says so",
        run: ({ parsed, events }) => {
          if (parsed.anchors !== null) return "an absent general_preferences.csv produced anchors anyway";
          const session = workoutsOf(events)[0];
          if (!session) return "no sessions were parsed";
          return (
            session.metadata.rpeBasis === "session_max_hr" ||
            `rpeBasis was ${session.metadata.rpeBasis} with no athlete maximum available`
          );
        }
      },
      {
        name: "a decision still lands for an athlete with training data and nothing else",
        run: ({ decision }) =>
          Boolean(decision.decision?.type) || "no decision came back for a Strava-only athlete"
      }
    ]
  }
];
