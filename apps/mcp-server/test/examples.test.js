// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The demo prompts, pinned.
 *
 * `examples/README.md` quotes a decision, a governing rule and a confidence for
 * each sample. Those are the first things anyone evaluating Evidra will run, so
 * a quiet drift between the file and the engine is a demo that fails in front of
 * the person deciding whether to list it.
 *
 * Prose cannot be tested, but the figures the prose quotes can be. Every number
 * asserted below appears verbatim in that README; changing one means changing
 * both, which is the point.
 *
 * The samples are fabricated evidence — they exist to show the shape. The
 * outputs are not fabricated, and this file is what keeps that true.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleJsonRpcMessage } from "../src/server.js";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../examples");

// The samples timestamp themselves relative to this day, so the quoted output
// does not change with the calendar.
const ANCHOR = "2026-08-06";

let nextId = 900;

async function call(name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } })
  );
  assert.equal(response.error, undefined, `${name} failed at the protocol level`);
  const payload = JSON.parse(response.result.content[0].text);
  assert.ok(
    !response.result.isError,
    `${name} refused the sample: ${payload.problem ?? payload.error ?? "unknown"}`
  );
  return payload;
}

const loadSample = async (file) => JSON.parse(await readFile(join(examplesDir, file), "utf8"));

const SESSION = { type: "run", durationMinutes: 60, intensity: "high", targetMuscleGroups: ["legs"] };

test("demo 1: spoken evidence alone decides, and says how little it stands on", async () => {
  const result = await call("evidra_decide_session", {
    date: ANCHOR,
    scheduledSession: { ...SESSION, focus: "VO₂max Intervals" },
    evidence: {
      workouts: [
        {
          type: "run",
          startedAt: "2026-08-05T07:00:00Z",
          durationMinutes: 80,
          trainingLoad: 210,
          source: "self_reported"
        }
      ],
      healthMetrics: [
        { type: "sleep_duration_hours", value: 6, unit: "hours", recordedAt: `${ANCHOR}T06:00:00Z`, source: "self_reported" }
      ]
    }
  });

  // keep is a decision. If this ever stops being `keep`, the README's whole
  // point about "checked, and it stands" has changed.
  assert.equal(result.decision.type, "keep");
  assert.equal(result.decision.intent, "proceed_as_planned");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.signalCoverage.recovery.missing, ["hrv", "restingHeartRate", "stress"]);
});

test("demo 2: training load alone decides, with no recovery signal at all", async () => {
  const result = await call("evidra_decide_session", {
    date: ANCHOR,
    scheduledSession: { ...SESSION, focus: "Threshold Repeats" },
    evidence: await loadSample("evidence-strava-only.json")
  });

  assert.equal(result.decision.type, "adjust");
  assert.equal(result.action.to.intensity, "moderate");
  assert.equal(result.decisionBasis.governingRule.ruleId, "EVD-R-006");
  assert.equal(result.decisionBasis.governingRule.measured.value, 1.61);
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.signalCoverage.recovery.missing, ["sleep", "hrv", "restingHeartRate", "stress"]);
});

test("demo 3: a vendor composite arrives as first-class evidence and lifts confidence", async () => {
  const evidence = await loadSample("evidence-garmin-hard-day.json");

  // The sample is only worth shipping if it exercises the field the input
  // schema advertises — the one nothing validated until it was added.
  assert.equal(evidence.vendorAssessments[0].type, "body_battery");

  const result = await call("evidra_decide_session", {
    date: ANCHOR,
    scheduledSession: { ...SESSION, focus: "Tempo Run", durationMinutes: 50 },
    evidence
  });

  assert.equal(result.decision.type, "adjust");
  assert.equal(result.decisionBasis.governingRule.ruleId, "EVD-R-002");
  assert.equal(result.decisionBasis.governingRule.measured.value, 48);
  assert.equal(result.confidence, "high");
  assert.deepEqual(result.signalCoverage.recovery.missing, []);
  assert.ok(
    result.signalCoverage.recovery.usable.includes("bodyBattery"),
    "a Body Battery that was sent must show up as a signal that was used"
  );
});

test("demo 4: recovery signals alone can decide upward, not only downward", async () => {
  const result = await call("evidra_decide_session", {
    date: ANCHOR,
    scheduledSession: { ...SESSION, focus: "VO₂max Intervals", intensity: "low" },
    evidence: await loadSample("evidence-oura-only.json")
  });

  // The demo set would be misleading if every case reduced something.
  assert.equal(result.decision.type, "advance");
  assert.equal(result.action.to.intensity, "moderate");
  assert.equal(result.decisionBasis.governingRule.ruleId, "EVD-R-008");
  assert.equal(result.confidence, "low");
});

test("demo 5: a contraindicated movement is filtered out, not ranked down", async () => {
  // The equipment list has to leave a contraindicated candidate reachable, or
  // this demo does not demonstrate what it says it does. It used to read
  // ["bodyweight", "dumbbell"], which removes Front Squat for having no barbell
  // *before* the knee filter is consulted — so the filter excluded nothing, and
  // the sentence asserted below was printed anyway, on the strength of the
  // caller having sent an avoid list at all. Found on 2026-08-09 when the
  // filter started reporting what it had actually removed.
  const result = await call("evidra_decide_exercise_substitution", {
    exerciseId: "back squat",
    avoidContraindications: ["knee"],
    availableEquipment: ["bodyweight", "dumbbell", "barbell", "squat_rack"]
  });

  assert.equal(result.decision.type, "substitute");
  assert.equal(result.action.from.name, "Back Squat");
  assert.equal(result.action.to.name, "Bodyweight Squat");
  assert.ok(
    result.reason.some((line) => line.includes("hard-filtered")),
    "the hard filter is the claim; it has to be stated in the reason the user sees"
  );
  // And the claim has to name a movement, because "a filter ran" and "a filter
  // removed something" are the two states this sentence used to conflate.
  assert.ok(
    result.reason.some((line) => line.includes("Front Squat")),
    "the reason must name what the filter removed, not merely say that it ran"
  );
  assert.equal(result.decisionBasis.governingRule.ruleId, "EVD-R-012");
  assert.deepEqual(result.decisionBasis.governingRule.measured.excluded[0].matchedTags, ["knee"]);
  assert.ok(!result.action.to.contraindications?.includes("knee"));
});

test("the sample scheduled session is what makes any of this a decision", async () => {
  const scheduledSession = await loadSample("scheduled-session.json");
  assert.ok(scheduledSession.focus && scheduledSession.intensity);

  // Without it there is no from -> to, and the tool says so rather than
  // inventing a plan. This is the line the README draws between a decision and
  // a recommendation, so it is asserted rather than described.
  const result = await call("evidra_decide_session", {
    date: ANCHOR,
    evidence: await loadSample("evidence-oura-only.json")
  });

  assert.equal(result.decision.intent, "no_scheduled_session");
  assert.equal(result.action.from, null, "there is no prior state to change");
  assert.equal(result.action.to, null);
  assert.deepEqual(result.action.changed, []);
  assert.ok(
    result.reason.some((line) => line.includes("recommendation question, not a decision")),
    "the engine has to name what it is declining to do, in words the user can be told"
  );
});
