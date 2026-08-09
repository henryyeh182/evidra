// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The engine parameters: numbers that change a decision and belong to no rule.
 *
 * Why they are not in `session-rules.json`. A rule has a category, a priority,
 * an effect and a place in arbitration, and every threshold in that file is
 * owned by one. These are not rules and pretending otherwise would put nine
 * entries into arbitration that nothing arbitrates. What they share with rules
 * is the part that matters: a value the engine reads from data rather than from
 * a literal, with its basis, its absence of sources and its limitations
 * attached, so that "no evidence" is a field rather than a silence.
 *
 * Why they are governed at all. `detrainingMinIdleDays` decides whether
 * EVD-R-007 is allowed to fire; `baselineHrvMs` sits underneath a readiness
 * score that three rules cut. Both change what Evidra decides, neither appears
 * in any `decisionBasis`, and until 2026-08-08 both were bare literals that
 * could be edited without anything going red.
 */

import { parameterSourceJson } from "./parameterSource.js";

const BASES = ["external_metric", "internal_composite"];
const STATUSES = ["draft", "active", "deprecated"];
const PARAMETER_ID_PATTERN = /^EVD-P-\d{3}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(`Engine parameter set invariant violated: ${message}`);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Validate on load, so a malformed set is a startup failure rather than a wrong
 * number discovered later.
 *
 * The fields checked are the ones that would otherwise fail silently. A missing
 * `limitations` entry is the case worth being strict about: a parameter with no
 * sources and no stated limitation reads as a number somebody stood behind, and
 * none of these are.
 */
export function assertValidParameterSet(set) {
  if (!set || typeof set !== "object") fail("the set is not an object.");
  if (!SEMVER_PATTERN.test(set.version || "")) fail(`version "${set.version}" is not semver.`);
  if (!Array.isArray(set.parameters) || set.parameters.length === 0) {
    fail("the set declares no parameters.");
  }

  const groupIds = new Set((set.groups || []).map((group) => group.id));
  const seenIds = new Set();
  const seenKeys = new Set();

  for (const parameter of set.parameters) {
    const where = `parameter ${parameter.parameterId || "(no id)"}`;

    if (!PARAMETER_ID_PATTERN.test(parameter.parameterId || "")) {
      fail(`${where} has an id that is not EVD-P-NNN.`);
    }
    if (seenIds.has(parameter.parameterId)) fail(`${where} is declared twice.`);
    seenIds.add(parameter.parameterId);

    if (typeof parameter.key !== "string" || parameter.key.length === 0) {
      fail(`${where} declares no key for the engine to read it by.`);
    }
    if (seenKeys.has(parameter.key)) {
      fail(`${where} reuses key "${parameter.key}", so one of the two would silently win.`);
    }
    seenKeys.add(parameter.key);

    if (!STATUSES.includes(parameter.status)) fail(`${where} has status "${parameter.status}".`);
    if (!BASES.includes(parameter.basis)) fail(`${where} has basis "${parameter.basis}".`);
    if (!groupIds.has(parameter.group)) fail(`${where} names undeclared group "${parameter.group}".`);
    if (typeof parameter.value !== "number" || !Number.isFinite(parameter.value)) {
      fail(`${where} has a non-numeric value.`);
    }
    if (typeof parameter.unit !== "string" || parameter.unit.length === 0) {
      fail(`${where} declares no unit, so its value cannot be read.`);
    }
    if (!Array.isArray(parameter.sources)) fail(`${where} declares no sources array.`);
    if (!Array.isArray(parameter.limitations) || parameter.limitations.length === 0) {
      fail(
        `${where} states no limitation. Every parameter here is a number we chose; one that says ` +
          `nothing about that reads as a number somebody stood behind.`
      );
    }
    if (parameter.basis === "internal_composite" && parameter.sources.length > 0) {
      fail(`${where} is internal_composite and cites sources, which cannot support a score we compute.`);
    }
  }

  return set;
}

const parameterSet = deepFreeze(assertValidParameterSet(JSON.parse(parameterSourceJson)));

const byKey = new Map(
  parameterSet.parameters.filter((p) => p.status === "active").map((p) => [p.key, p])
);

/**
 * The numbers the engines actually apply, flattened out of the set.
 *
 * The same join `THRESHOLDS` makes for the rule library: the engines hold no
 * literals of their own for these, so editing a value in engine-parameters.json
 * changes what Evidra computes.
 */
export const PARAMETERS = Object.freeze(
  Object.fromEntries([...byKey].map(([key, parameter]) => [key, parameter.value]))
);

export const PARAMETER_SET_VERSION = parameterSet.version;

export function getParameterSet() {
  return parameterSet;
}

export function getParameter(key) {
  const parameter = byKey.get(key);
  if (!parameter) throw new Error(`Unknown engine parameter "${key}".`);
  return parameter;
}

const groupsByAppliedBy = new Map();
for (const group of parameterSet.groups || []) {
  if (!groupsByAppliedBy.has(group.appliedBy)) groupsByAppliedBy.set(group.appliedBy, []);
  groupsByAppliedBy.get(group.appliedBy).push(group.id);
}

/**
 * Both directions of the join, checked at each consumer's module load.
 *
 * A key the engine reads that nothing declares fails here rather than
 * evaluating to `undefined` inside a comparison — which is how a staleness
 * window with a typo would silently drop every reading of that type. And a
 * parameter nobody applies fails too, so this file cannot fill up with numbers
 * that look governed and are not.
 *
 * The second direction needs to know whose parameters these are, or a file that
 * reads two of the nine would look like a file that lost seven. That is what
 * each group's `appliedBy` is for: the caller names itself, and the check is
 * against the parameters belonging to it.
 *
 * @param {string} appliedBy repo-relative path of the calling module, as the group declares it
 * @param {string[]} keys every parameter key that module reads
 */
export function assertParametersMatch(appliedBy, keys) {
  const owned = groupsByAppliedBy.get(appliedBy);
  if (!owned) {
    throw new Error(
      `${appliedBy} reads engine parameters and no group in engine-parameters.json names it in ` +
        `\`appliedBy\`, so there is nothing to check its list against.`
    );
  }

  const read = new Set(keys);
  for (const key of read) {
    if (!byKey.has(key)) {
      throw new Error(
        `${appliedBy} reads parameter "${key}" and engine-parameters.json declares no active ` +
          `parameter with that key.`
      );
    }
    if (!owned.includes(getParameter(key).group)) {
      throw new Error(
        `${appliedBy} reads parameter "${key}", which belongs to group ` +
          `"${getParameter(key).group}" and is applied elsewhere.`
      );
    }
  }

  const unread = [...byKey.values()]
    .filter((parameter) => owned.includes(parameter.group) && !read.has(parameter.key))
    .map((parameter) => parameter.key);
  if (unread.length > 0) {
    throw new Error(
      `engine-parameters.json says ${appliedBy} applies ${unread.join(", ")}, and it does not. A ` +
        `parameter nobody reads is decoration with provenance attached.`
    );
  }
}
