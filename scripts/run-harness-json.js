#!/usr/bin/env node

import { runHarness } from "../harness/runner.js";
import { buildRegressionBaseline } from "../harness/lib/regression.js";

const result = await runHarness();
const decisions = result.scenarios.map(({ scenario, result: run }) => ({
  id: scenario.id,
  decision: run.decision.decision,
  action: run.decision.action,
  decisionBasis: run.decision.decisionBasis,
  confidence: run.decision.confidence
}));
console.log(JSON.stringify({
  scenarios: result.scenarios.length,
  findings: result.findings,
  errors: result.errors,
  decisions,
  regression: buildRegressionBaseline(result)
}));
if (result.findings.length || result.errors.length) process.exitCode = 1;
