// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { librarySourceJson } from "./librarySource.js";
import { assertValidRuleLibrary, deriveEvidenceLevel } from "./models.js";

/**
 * The rule library is parsed once per process, at module load, and frozen.
 *
 * Synchronous on purpose: `decideSession` is a pure synchronous function and
 * every caller of it depends on that. Where the JSON comes from — a file next
 * to this one, or a string the build inlined — is `librarySource.js`'s
 * business, not this module's.
 */
const library = assertValidRuleLibrary(JSON.parse(librarySourceJson));

// The compatibility field, computed once rather than stored twice.
//
// `evidenceLevel` is what every existing contract reads, and it keeps working.
// It is attached here instead of being written into session-rules.json because
// a declared copy is free to disagree with the two axes it summarises, and a
// disagreement between them would be a provenance claim nobody made. The
// loader refuses to load a rule that declares the field itself.
for (const rule of library.rules) {
  rule.evidenceLevel = deriveEvidenceLevel(rule.evidence);
}

deepFreeze(library);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const byId = new Map(library.rules.map((rule) => [rule.ruleId, rule]));

const categoryRank = new Map(library.categories.map((category) => [category.id, category.rank]));

/**
 * The numbers the engine actually applies, flattened out of the rules that
 * declare them.
 *
 * This is the join that stops the library being decorative: the engine has no
 * literal thresholds of its own, so editing a value in session-rules.json
 * changes what Evidra decides. `assertThresholdsMatch` guards the other
 * direction — a number the engine reads but no rule declares fails the load.
 */
export const THRESHOLDS = Object.freeze(
  Object.fromEntries(
    library.rules.flatMap((rule) => rule.thresholds.map((threshold) => [threshold.key, threshold.value]))
  )
);

export function getRuleLibrary() {
  return library;
}

export function getRule(ruleId) {
  const rule = byId.get(ruleId);
  if (!rule) throw new Error(`Unknown ruleId "${ruleId}".`);
  return rule;
}

export function getCategoryRank(categoryId) {
  const rank = categoryRank.get(categoryId);
  if (rank === undefined) throw new Error(`Unknown rule category "${categoryId}".`);
  return rank;
}

/**
 * What a decision carries about the rule that produced it.
 *
 * This is the part the athlete — or a reviewer looking at Evidra after it is
 * listed — actually sees. It answers four questions in one object: which rule
 * fired, what it measured and against what threshold, what that rule's basis
 * is, and who disagrees with that basis.
 *
 * `evidence: { studyDesign: "none", recommendationStrength: "internal_heuristic" }`
 * with an empty `sources` is a normal and expected output here, not a gap to be
 * filled in later. Six of the eight rules are thresholds on scores Evidra
 * computes itself, and for those no citation is possible. Saying so is the
 * disclosure; hiding it behind a plausible-sounding reference would be the
 * failure.
 *
 * Both `evidence` and the older `evidenceLevel` go out. The flat field is the
 * one existing callers read and it is not going away; the object is where the
 * two questions it used to conflate — what kind of study, and how far that
 * study reaches toward our number — are answered separately.
 */
export function describeRule(ruleId, measured = null, { full = true } = {}) {
  const rule = getRule(ruleId);

  // The compact form. Full citations, objections and limitations for every rule
  // that fired pushed a single decision past 12KB — enough that a host would
  // start paying for provenance in context it needed for the conversation.
  //
  // So the split follows what a reader actually does with the field: the rule
  // the decision is attributed to gets the complete record, including who
  // disputes it; the rules that also fired but did not govern get identity,
  // basis and the reading that triggered them. `basis`, `evidence` and
  // `evidenceLevel` survive in both forms, because "this one rests on a score
  // we invented" is the disclosure, and it must not be the part that gets
  // trimmed for size.
  if (!full) {
    return {
      ruleId: rule.ruleId,
      title: rule.title,
      category: rule.category,
      basis: rule.basis,
      evidence: { ...rule.evidence },
      evidenceLevel: rule.evidenceLevel,
      ...(measured ? { measured } : {}),
      sourceCount: rule.sources.length,
      contestedCount: rule.contested?.length ?? 0
    };
  }

  return {
    ruleId: rule.ruleId,
    ruleVersion: rule.version,
    title: rule.title,
    category: rule.category,
    basis: rule.basis,
    evidence: { ...rule.evidence },
    evidenceLevel: rule.evidenceLevel,
    ...(measured ? { measured } : {}),
    thresholds: rule.thresholds.map((threshold) => ({
      key: threshold.key,
      operator: threshold.operator,
      value: threshold.value,
      unit: threshold.unit
    })),
    sources: rule.sources.map((source) => ({
      citation: source.citation,
      ...(source.doi ? { doi: source.doi } : {}),
      ...(source.url ? { url: source.url } : {}),
      supports: source.supports,
      doesNotSupport: source.doesNotSupport,
      // Unconditional. While this was spread in only when present, a citation
      // nobody had checked came out looking exactly like one with nothing to
      // declare — the absent field and the weakest status were the same output.
      verificationStatus: source.verificationStatus
    })),
    ...(rule.supportingLiterature?.length
      ? {
          supportingLiterature: rule.supportingLiterature.map((item) => ({
            citation: item.citation,
            ...(item.url ? { url: item.url } : {}),
            supports: item.supports,
            doesNotSupport: item.doesNotSupport,
            verificationStatus: item.verificationStatus
          }))
        }
      : {}),
    ...(rule.contested?.length
      ? {
          contested: rule.contested.map((item) => ({
            citation: item.citation,
            ...(item.url ? { url: item.url } : {}),
            objection: item.objection
          }))
        }
      : {}),
    limitations: [...rule.limitations]
  };
}

export const LIBRARY_VERSION = library.version;
