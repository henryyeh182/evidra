import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeAthlete,
  createAuditEvent,
  principalFromClaims,
  teamDecisionSummary
} from "../src/index.js";

test("principal and athlete access are tenant-scoped", () => {
  const coach = principalFromClaims({ sub: "coach-1", tenant_id: "team-a", roles: ["coach"], athlete_ids: ["athlete-1"] });
  assert.equal(authorizeAthlete(coach, { athleteId: "athlete-1" }).ok, true);
  assert.equal(authorizeAthlete(coach, { athleteId: "athlete-2" }).reason, "athlete_out_of_scope");
  assert.equal(authorizeAthlete(coach, { tenantId: "team-b", athleteId: "athlete-1" }).reason, "tenant_mismatch");
  assert.equal(authorizeAthlete(coach, { athleteId: "athlete-1", permission: "athlete:read:self" }).reason, "role_not_permitted");
});

test("athletes can read themselves but cannot cross tenant or athlete scope", () => {
  const athlete = principalFromClaims({ sub: "athlete-1", tenant_id: "team-a", role: "athlete" });
  assert.equal(authorizeAthlete(athlete, { athleteId: "athlete-1", permission: "athlete:read:self" }).ok, true);
  assert.equal(authorizeAthlete(athlete, { athleteId: "athlete-2", permission: "athlete:read:self" }).ok, false);
});

test("team summaries omit raw evidence and audit events redact sensitive metadata", () => {
  const principal = principalFromClaims({ sub: "coach-1", tenant_id: "team-a", roles: ["coach"], athlete_ids: ["athlete-1"] });
  const summary = teamDecisionSummary({ decisionId: "dec_1", athleteId: "athlete-1", decision: "adjust", readiness: 62 });
  assert.deepEqual(summary, { decisionId: "dec_1", athleteId: "athlete-1", decision: "adjust", readiness: 62, confidence: null, signalCoverage: null });
  const event = createAuditEvent({ principal, action: "decision.read", resource: "athlete-1", metadata: { decisionId: "dec_1", evidence: { hrv: 42 }, note: "coach review" }, now: "2026-08-10T00:00:00Z" });
  assert.equal(event.tenantId, "team-a");
  assert.deepEqual(event.metadata, { decisionId: "dec_1", evidence: "[REDACTED]", note: "coach review" });
});

test("untrusted or incomplete claims fail closed", () => {
  assert.throws(() => principalFromClaims({ sub: "coach-1", roles: ["coach"] }), /no tenant/);
  assert.throws(() => principalFromClaims({ sub: "coach-1", tenant_id: "team-a", roles: ["owner"] }), /unsupported role/);
});
