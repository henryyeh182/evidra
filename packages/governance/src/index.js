// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Pacevera — proprietary. See LICENSE at the repository root.

const ROLES = new Set(["athlete", "coach", "team_admin", "clinician", "auditor"]);

const ROLE_PERMISSIONS = Object.freeze({
  athlete: ["athlete:read:self", "decision:read:self"],
  coach: ["athlete:read:summary", "decision:read:summary", "decision:read:trace"],
  team_admin: ["athlete:read:summary", "decision:read:summary", "decision:read:trace", "team:manage"],
  clinician: ["athlete:read:summary", "decision:read:summary", "decision:read:trace"],
  auditor: ["decision:read:trace", "audit:read"]
});

const SENSITIVE_FIELDS = new Set([
  "evidence", "rawEvidence", "healthMetrics", "workouts", "injuries", "accessToken",
  "refreshToken", "authorization", "token", "claims"
]);

function list(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.length > 0);
  if (typeof value === "string") return value.split(/[ ,]+/).filter(Boolean);
  return [];
}

/** Convert verified JWT claims into the small, explicit principal used by P4. */
export function principalFromClaims(claims) {
  if (!claims || typeof claims !== "object") throw new Error("A verified identity is required.");
  const tenantId = claims.tenant_id || claims.tenantId;
  const subject = claims.sub || claims.user_id || claims.userId;
  const roles = list(claims.roles || claims.role);
  const athleteIds = list(claims.athlete_ids || claims.athleteIds);
  if (typeof tenantId !== "string" || !tenantId) throw new Error("Identity has no tenant.");
  if (typeof subject !== "string" || !subject) throw new Error("Identity has no subject.");
  if (roles.length === 0 || roles.some((role) => !ROLES.has(role))) throw new Error("Identity has an unsupported role.");
  return Object.freeze({ tenantId, subject, roles: Object.freeze(roles), athleteIds: Object.freeze(athleteIds) });
}

export function permissionsFor(principal) {
  return [...new Set(principal.roles.flatMap((role) => ROLE_PERMISSIONS[role] || []))];
}

/**
 * Decide access to an athlete without ever using a caller-supplied tenant id.
 * The tenant and athlete allow-list come from the verified principal.
 */
export function authorizeAthlete(principal, { tenantId, athleteId, permission = "athlete:read:summary" } = {}) {
  if (!principal || typeof athleteId !== "string" || !athleteId) {
    return { ok: false, status: 403, reason: "missing_identity_or_athlete" };
  }
  if (tenantId !== undefined && tenantId !== principal.tenantId) {
    return { ok: false, status: 403, reason: "tenant_mismatch" };
  }
  const permissions = new Set(permissionsFor(principal));
  if (!permissions.has(permission)) return { ok: false, status: 403, reason: "role_not_permitted" };
  const self = principal.roles.includes("athlete") && principal.subject === athleteId;
  const scoped = principal.athleteIds.includes(athleteId);
  if (self || scoped) return { ok: true, tenantId: principal.tenantId, athleteId, permission };
  return { ok: false, status: 403, reason: "athlete_out_of_scope" };
}

/** Team outputs are intentionally summary-only; raw payloads are never audit data. */
export function teamDecisionSummary({ decisionId, athleteId, decision, readiness, confidence, signalCoverage } = {}) {
  return {
    decisionId: decisionId || null,
    athleteId: athleteId || null,
    decision: decision || null,
    readiness: readiness ?? null,
    confidence: confidence ?? null,
    signalCoverage: signalCoverage || null
  };
}

function redact(value, key = "") {
  if (SENSITIVE_FIELDS.has(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
}

export function createAuditEvent({ principal, action, resource, outcome = "allowed", metadata = {}, now = new Date() } = {}) {
  if (!principal?.tenantId || !principal.subject) throw new Error("Audit events require a principal.");
  if (typeof action !== "string" || typeof resource !== "string") throw new Error("Audit events require action and resource.");
  return Object.freeze({
    occurredAt: new Date(now).toISOString(),
    tenantId: principal.tenantId,
    actorId: principal.subject,
    roles: [...principal.roles],
    action,
    resource,
    outcome,
    metadata: redact(metadata)
  });
}

export const governanceRoles = Object.freeze([...ROLES]);
