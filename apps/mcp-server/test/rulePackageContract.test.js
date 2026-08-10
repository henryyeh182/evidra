import test from "node:test";
import assert from "node:assert/strict";
import { handleJsonRpcMessage } from "../src/server.js";
import { getRuleLibrary } from "../../../packages/rules/src/index.js";
import { loadBaseRulePackage } from "../../../packages/rules/src/packageBoundary.js";
import { ENGINE_VERSION } from "../../../packages/decision-engine/src/version.js";

async function call(name, arguments_) {
  const response = await handleJsonRpcMessage(JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ }
  }));
  return JSON.parse(response.result.content[0].text);
}

test("package-to-runtime decision harness contract keeps trace identity", async () => {
  const loaded = loadBaseRulePackage({ engineVersion: ENGINE_VERSION });
  assert.deepEqual(
    loaded.manifest.rules.map(({ id }) => id),
    getRuleLibrary().rules.map(({ ruleId }) => ruleId),
    "the active package and runtime library must expose the same Rule IDs"
  );

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

test("package loading preserves the complete decision output contract", async () => {
  const arguments_ = {
    userId: "r0-contract-stable",
    evidence: { readinessScore: 75, recoveryScore: 80, fatigueScore: 20, acuteChronicWorkloadRatio: 0.9 },
    scheduledSession: { focus: "easy run", type: "run", durationMinutes: 30, intensity: "moderate" }
  };
  const first = await call("decide_session", arguments_);
  const second = await call("decide_session", arguments_);
  const stable = ({ decisionId, ...output }) => output;
  assert.deepEqual(stable(first), stable(second));
  assert.deepEqual(first.decision, { type: "keep", intent: "proceed_as_planned" });
  assert.deepEqual(first.action.changed, []);
  assert.equal(first.action.to.intensity, "moderate");
  assert.equal(first.action.to.durationMinutes, 30);
  assert.deepEqual(first.decisionBasis, second.decisionBasis);
  assert.match(first.decisionId, /^dec_[0-9a-f]{24}$/);
  assert.ok(first.decisionBasis.libraryVersion);
  assert.ok(first.decisionBasis.engineVersion);

  const explanation = await call("explain_decision", { decisionId: first.decisionId });
  assert.deepEqual(explanation.trace.decision, first.decision);
  assert.deepEqual(explanation.trace.decisionBasis, first.decisionBasis);
});
