import test from "node:test";
import assert from "node:assert/strict";
import { handleJsonRpcMessage } from "../src/server.js";

async function call(name, arguments_) {
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ }
  }));
  return JSON.parse(response.result.content[0].text);
}

test("package-to-runtime decision harness contract keeps trace identity", async () => {
  const result = await call("decide_session", {
    userId: "r0-contract",
    evidence: { readinessScore: 75, recoveryScore: 80, fatigueScore: 20, acuteChronicWorkloadRatio: 0.9 },
    scheduledSession: { focus: "easy run", type: "run", durationMinutes: 30, intensity: "moderate" }
  });

  assert.match(result.decisionId, /^dec_[0-9a-f]{24}$/);
  assert.ok(result.decisionBasis);
  assert.ok(result.decisionBasis.libraryVersion);
  assert.ok(result.decisionBasis.engineVersion);
  const explanation = await call("explain_decision", { decisionId: result.decisionId });
  assert.equal(explanation.decisionId, result.decisionId);
  assert.deepEqual(explanation.trace.decisionBasis, result.decisionBasis);
  assert.equal(explanation.trace.versions.ruleLibrary, result.decisionBasis.libraryVersion);
});
