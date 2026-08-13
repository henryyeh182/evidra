import { ruleCandidateSchemaJson } from "./ruleCandidateSchemaSource.js";

const SCHEMA = JSON.parse(ruleCandidateSchemaJson);
function typeOf(value) { if (value === null) return "null"; if (Array.isArray(value)) return "array"; return typeof value; }
function fail(message) { throw new Error(`Rule candidate invariant violated: ${message}`); }
function validate(value, schema, path = "$") {
  if (schema.type && ![].concat(schema.type).includes(typeOf(value))) fail(`${path} has the wrong type.`);
  if (schema.const !== undefined && !Object.is(value, schema.const)) fail(`${path} must be ${schema.const}.`);
  if (schema.enum && !schema.enum.includes(value)) fail(`${path} must be one of ${schema.enum.join(", ")}.`);
  if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${path} has an invalid format.`);
  if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${path} is too short.`);
  if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${path} needs at least ${schema.minItems} item(s).`);
  if (schema.required) for (const key of schema.required) if (!Object.hasOwn(value, key)) fail(`${path}.${key} is required.`);
  if (schema.additionalProperties === false && schema.properties) for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail(`${path}.${key} is not allowed.`);
  if (schema.properties) for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key)) validate(value[key], child, `${path}.${key}`);
  if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
}
export function validateRuleCandidate(candidate) {
  validate(candidate, SCHEMA);
  if (candidate.proposedRule.basis === "internal_composite" && candidate.proposedRule.evidence.recommendationStrength !== "internal_heuristic") fail("an internal_composite candidate must use internal_heuristic evidence strength.");
  if (candidate.proposedRule.basis === "internal_composite" && candidate.sourceDocuments.some((source) => source.sourceType !== "internal_outcome" && source.supports?.match(/threshold|cut point|score/i))) fail("an internal_composite candidate cannot claim literature supports its invented threshold.");
  return structuredClone(candidate);
}
