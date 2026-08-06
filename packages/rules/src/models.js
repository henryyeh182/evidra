// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * Invariants over the rule library.
 *
 * These run every time the library is loaded, which means a malformed or
 * dishonest rule fails the process rather than reaching a decision. That is the
 * same posture `assertValidProgressions` takes in the knowledge graph: the data
 * is the product, so the data is what gets guarded.
 */

const CATEGORY_IDS = ["injury", "illness", "recovery", "training_goal", "preference"];

const EVIDENCE_LEVELS = [
  "guideline",
  "position_stand",
  "systematic_review",
  "rct",
  "observational",
  "expert_consensus",
  "internal_heuristic"
];

const BASES = ["external_metric", "internal_composite"];
const STATUSES = ["draft", "active", "deprecated"];
const RULE_ID_PATTERN = /^EVD-R-\d{3}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(`Rule library invariant violated: ${message}`);
}

/**
 * The invariant this file exists for.
 *
 * A threshold on a score Evidra computes itself cannot be supported by any
 * publication, because no publication has ever used that score. Attaching a
 * real citation to such a threshold would produce a rule that looks
 * evidence-based and is not — the single most damaging thing this library could
 * ship, since a reader who checks the citation finds it never mentions the
 * quantity. So the check is structural rather than editorial: an
 * `internal_composite` rule with a non-empty `sources` array cannot load.
 *
 * Rules may still record `supportingLiterature`, which is a different claim:
 * "this publication supports the existence and direction of the rule, and
 * explicitly not its number." That field requires `doesNotSupport` to be filled
 * in, so the distinction cannot be quietly dropped.
 */
function assertProvenanceHonesty(rule) {
  const where = `${rule.ruleId}`;

  if (rule.basis === "internal_composite") {
    if (rule.sources.length > 0) {
      fail(
        `${where} has basis "internal_composite" but lists ${rule.sources.length} source(s). ` +
          `A threshold on an Evidra-computed score cannot be supported by a publication that ` +
          `has never used that score. Move the citation to supportingLiterature and state what ` +
          `it does not support, or change the basis if the quantity is in fact externally defined.`
      );
    }
    if (rule.evidenceLevel !== "internal_heuristic") {
      fail(
        `${where} has basis "internal_composite" but evidenceLevel "${rule.evidenceLevel}". ` +
          `Without sources there is nothing to raise the level above internal_heuristic.`
      );
    }
    if (!rule.measuredQuantity?.sameAs && !rule.measuredQuantity?.whyNoSourceIsPossible) {
      fail(
        `${where} is internal_composite so it must say, in measuredQuantity.whyNoSourceIsPossible, ` +
          `why no publication can speak to this threshold — or point at a rule that does via sameAs.`
      );
    }
  }

  if (rule.basis === "external_metric") {
    if (rule.sources.length === 0) {
      fail(
        `${where} has basis "external_metric" but no sources. If the quantity is externally ` +
          `defined, say who defined it; if it is not, the basis is wrong.`
      );
    }
    if (rule.evidenceLevel === "internal_heuristic") {
      fail(`${where} cites sources but claims evidenceLevel "internal_heuristic". Pick the level the sources actually support.`);
    }
  }

  for (const source of rule.sources) {
    if (!source.citation) fail(`${where} has a source with no citation.`);
    if (!source.supports) fail(`${where} source "${source.citation}" does not say what it supports.`);
    if (!source.doesNotSupport) {
      fail(
        `${where} source "${source.citation}" does not say what it does NOT support. ` +
          `Every citation in this library must name the gap between the publication and our threshold, ` +
          `because in every case so far there is one.`
      );
    }
  }

  for (const item of rule.supportingLiterature ?? []) {
    if (!item.citation) fail(`${where} has supportingLiterature with no citation.`);
    if (!item.doesNotSupport) {
      fail(`${where} supportingLiterature "${item.citation}" must state what it does not support.`);
    }
  }

  for (const item of rule.contested ?? []) {
    if (!item.citation || !item.objection) {
      fail(`${where} has a contested entry missing a citation or an objection.`);
    }
  }
}

/**
 * Every threshold the engine applies must exist in the library, and every
 * threshold in the library must be applied by the engine. Without both
 * directions the library drifts into documentation: a number could be edited
 * here and change nothing, or added to the engine and be invisible here.
 */
export function assertThresholdsMatch(library, engineThresholdKeys) {
  const libraryKeys = new Set();
  for (const rule of library.rules) {
    for (const threshold of rule.thresholds) libraryKeys.add(threshold.key);
  }

  const missingFromLibrary = engineThresholdKeys.filter((key) => !libraryKeys.has(key));
  if (missingFromLibrary.length > 0) {
    fail(
      `the engine applies threshold(s) [${missingFromLibrary.join(", ")}] that no rule declares. ` +
        `An unsourced number reached the decision path without passing through the library.`
    );
  }

  const unusedInEngine = [...libraryKeys].filter((key) => !engineThresholdKeys.includes(key));
  if (unusedInEngine.length > 0) {
    fail(
      `the library declares threshold(s) [${unusedInEngine.join(", ")}] that the engine never reads. ` +
        `A rule nobody applies is documentation, not a rule.`
    );
  }
}

export function assertValidRuleLibrary(library) {
  if (!SEMVER_PATTERN.test(library.version ?? "")) fail(`library version "${library.version}" is not semver.`);
  if (!Array.isArray(library.rules) || library.rules.length === 0) fail("library has no rules.");

  const categoryIds = library.categories.map((category) => category.id);
  for (const id of CATEGORY_IDS) {
    if (!categoryIds.includes(id)) fail(`the priority matrix is missing category "${id}".`);
  }
  const ranks = library.categories.map((category) => category.rank);
  if (new Set(ranks).size !== ranks.length) fail("two categories share a rank, so arbitration would be ambiguous.");

  const seen = new Set();
  for (const rule of library.rules) {
    const where = rule.ruleId ?? "(rule with no id)";

    if (!RULE_ID_PATTERN.test(rule.ruleId ?? "")) fail(`"${where}" is not of the form EVD-R-000.`);
    if (seen.has(rule.ruleId)) fail(`${where} is declared twice.`);
    seen.add(rule.ruleId);

    if (!SEMVER_PATTERN.test(rule.version ?? "")) fail(`${where} version "${rule.version}" is not semver.`);
    if (!rule.title) fail(`${where} has no title.`);
    if (!STATUSES.includes(rule.status)) fail(`${where} has status "${rule.status}".`);
    if (!categoryIds.includes(rule.category)) fail(`${where} has category "${rule.category}".`);
    if (!BASES.includes(rule.basis)) fail(`${where} has basis "${rule.basis}".`);
    if (!EVIDENCE_LEVELS.includes(rule.evidenceLevel)) fail(`${where} has evidenceLevel "${rule.evidenceLevel}".`);

    if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 100) {
      fail(`${where} has priority ${rule.priority}, outside 0-100.`);
    }

    if (!Array.isArray(rule.thresholds) || rule.thresholds.length === 0) {
      fail(`${where} declares no threshold, so nothing about it is checkable.`);
    }
    for (const threshold of rule.thresholds) {
      if (!threshold.key) fail(`${where} has a threshold with no key.`);
      if (typeof threshold.value !== "number") fail(`${where} threshold "${threshold.key}" has a non-numeric value.`);
      if (!threshold.unit) fail(`${where} threshold "${threshold.key}" has no unit.`);
    }

    if (!Array.isArray(rule.sources)) fail(`${where} has no sources array (use [] when there are none).`);
    if (!Array.isArray(rule.limitations) || rule.limitations.length === 0) {
      fail(
        `${where} lists no limitations. Every rule in this library has at least one — most obviously ` +
          `that its threshold was chosen by us — and an empty list means it has not been reviewed.`
      );
    }

    assertProvenanceHonesty(rule);
  }

  return library;
}

export { CATEGORY_IDS, EVIDENCE_LEVELS, BASES };
