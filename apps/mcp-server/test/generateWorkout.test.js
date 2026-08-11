import test from "node:test";
import assert from "node:assert/strict";
import { handleJsonRpcMessage } from "../src/server.js";

let nextId = 3000;
async function call(name, arguments_) {
  const response = await handleJsonRpcMessage(JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: arguments_ } }));
  assert.equal(response.error, undefined);
  return JSON.parse(response.result.content[0].text);
}

const evidence = {
  profile: { timezone: "Asia/Taipei", fitnessLevel: "intermediate" },
  constraints: { availableMinutes: 10, equipment: ["outdoor"] },
  healthMetrics: [
    { type: "sleep_duration_hours", value: 8, recordedAt: "2026-08-11T06:00:00+08:00", source: "manual" },
    { type: "sleep_quality", value: 90, recordedAt: "2026-08-11T06:00:00+08:00", source: "manual" },
    { type: "hrv_ms", value: 60, recordedAt: "2026-08-11T06:00:00+08:00", source: "manual" },
    { type: "resting_hr_bpm", value: 55, recordedAt: "2026-08-11T06:00:00+08:00", source: "manual" },
    { type: "stress", value: 10, recordedAt: "2026-08-11T06:00:00+08:00", source: "manual" }
  ],
  workouts: []
};

test("generate_workout returns a picker-sized personalized session", async () => {
  const result = await call("generate_workout", { date: "2026-08-11", durationMinutes: 10, focus: "vo2max_intervals", evidence });
  assert.equal(result.tool, "generate_workout");
  assert.deepEqual(result.request, { durationMinutes: 10, focus: "vo2max_intervals" });
  assert.equal(result.decision.type, "workout_generated");
  assert.equal(result.action.from.durationMinutes, 10);
  assert.ok(result.workout.focus);
  assert.equal(result.provenance.scheduledSessionSource, "picker");
});

test("generate_workout rejects a duration outside the picker", async () => {
  const result = await call("generate_workout", { durationMinutes: 12, focus: "vo2max_intervals", evidence });
  assert.equal(result.error, "invalid_workout_duration");
  assert.deepEqual(result.allowed, [5, 10, 15, 20, 25, 30]);
});
