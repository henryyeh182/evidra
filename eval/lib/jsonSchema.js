// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

// Minimal, dependency-free JSON Schema validator.
//
// Supports the subset the Fitness MCP contracts actually use:
//   type (string or array of strings), enum, const, properties, required,
//   items, additionalProperties (boolean), minimum, minItems, nullable.
//
// It is intentionally small: the goal is a self-contained drift guard for
// tool I/O contracts, not full JSON Schema compliance. When a contract needs
// a keyword that is not handled here, add it here rather than pulling in a
// dependency — the whole repo is dependency-free on purpose.

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value; // "string" | "number" | "boolean" | "object"
}

function matchesType(value, expected) {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "object") return actual === "object";
  return actual === expected;
}

/**
 * Validate `value` against `schema`, collecting human-readable errors.
 *
 * @param {*} value
 * @param {object} schema
 * @param {string} [path]
 * @param {string[]} [errors]
 * @returns {string[]} list of error strings (empty means valid)
 */
export function collectErrors(value, schema, path = "$", errors = []) {
  if (!schema || typeof schema !== "object") {
    return errors;
  }

  // nullable: allow explicit null regardless of declared type.
  if (value === null && schema.nullable === true) {
    return errors;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type !== undefined) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => matchesType(value, expected))) {
      errors.push(`${path}: expected type ${expectedTypes.join("|")}, got ${typeOf(value)}`);
      return errors; // further checks are meaningless on a type mismatch
    }
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
  }

  if (typeOf(value) === "array") {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, index) => collectErrors(item, schema.items, `${path}[${index}]`, errors));
    }
  }

  if (typeOf(value) === "object") {
    const properties = schema.properties || {};
    for (const requiredKey of schema.required || []) {
      if (!(requiredKey in value)) {
        errors.push(`${path}: missing required property "${requiredKey}"`);
      }
    }
    for (const [key, propValue] of Object.entries(value)) {
      if (properties[key]) {
        collectErrors(propValue, properties[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        collectErrors(propValue, schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }

  return errors;
}

/**
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(value, schema) {
  const errors = collectErrors(value, schema);
  return { valid: errors.length === 0, errors };
}
