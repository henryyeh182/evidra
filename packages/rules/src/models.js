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

/**
 * The legacy single ladder. Derived output now, never declared by a rule.
 *
 * It mixed two questions that move independently — what kind of study this is,
 * and how far that study goes toward our threshold — so a rule could inherit
 * the strength of a published recommendation without any field showing how its
 * own evidence had been graded. `STUDY_DESIGNS` and `RECOMMENDATION_STRENGTHS`
 * are those two questions asked separately; `deriveEvidenceLevel` collapses
 * them back to this vocabulary so existing callers keep the field they read.
 */
const EVIDENCE_LEVELS = [
  "guideline",
  "position_stand",
  "systematic_review",
  "rct",
  "observational",
  "expert_consensus",
  "internal_heuristic"
];

/**
 * Axis 1: what kind of study supports this rule's threshold.
 *
 * `narrative_review` exists because EVD-R-007 needed it and the old ladder did
 * not have it: Mujika & Padilla are two-author reviews with no search method
 * described, which is not `systematic_review` and not `expert_consensus`
 * either. The rule recorded that gap in its own notes and rounded to the
 * nearest rung; rounding is no longer necessary.
 *
 * `none` is the honest value for a threshold no study supports, and it is the
 * value most rules in this library carry.
 */
const STUDY_DESIGNS = [
  "guideline",
  "position_stand",
  "systematic_review",
  "rct",
  "observational",
  "narrative_review",
  "expert_consensus",
  "none"
];

/**
 * Axis 2: how far that study goes toward the number this rule applies.
 *
 * The distinction the old ladder could not express. A position stand is strong
 * evidence for something; the question this axis answers is whether that
 * something is our cut point, or merely the direction our cut point moves in.
 * Today no rule in this library is `supports_threshold` — every citation's
 * `doesNotSupport` names the number as the thing it does not establish — and
 * that fact is now visible in a field rather than only in prose.
 */
const RECOMMENDATION_STRENGTHS = ["supports_threshold", "supports_direction_only", "internal_heuristic"];

/**
 * How far anyone here has actually read the document a citation names.
 *
 * Orthogonal to both axes above: a paper can be the strongest design there is
 * and still be something nobody opened. Ordered strongest first. The vocabulary
 * was written into the library's readMe on 2026-08-07 but not enforced, which
 * meant a typo in this field would have read as a verification claim and
 * nothing would have caught it.
 */
const VERIFICATION_STATUSES = [
  "primary_full_text_verified",
  "abstract_verified_full_text_not_read",
  "abstract_verified_full_text_paywalled",
  "numbers_from_secondary_sources",
  "citation_not_read_in_full",
  "unverified"
];

const BASES = ["external_metric", "internal_composite"];
const STATUSES = ["draft", "active", "deprecated"];
const RULE_ID_PATTERN = /^EVD-R-\d{3}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

function fail(message) {
  throw new Error(`Rule library invariant violated: ${message}`);
}

/**
 * The compatibility output: the two axes collapsed back to the old ladder.
 *
 * Kept so that splitting the schema does not also change every contract that
 * reads `evidenceLevel`. The collapse is lossy in exactly one place —
 * `narrative_review` has no rung in the old vocabulary and lands on
 * `expert_consensus`, which is the rounding EVD-R-007 was already doing by
 * hand. Read `evidence` when the difference matters.
 */
export function deriveEvidenceLevel(evidence) {
  if (evidence.recommendationStrength === "internal_heuristic") return "internal_heuristic";
  if (evidence.studyDesign === "narrative_review") return "expert_consensus";
  return evidence.studyDesign;
}

/**
 * The statuses that mean nobody here has confirmed this citation against a
 * primary record — not the paper, not even its published abstract.
 */
const UNCONFIRMED_STATUSES = ["numbers_from_secondary_sources", "citation_not_read_in_full", "unverified"];

/**
 * The invariant this library most needed and did not have.
 *
 * EVD-R-007 shipped in five public releases carrying "roughly 4-7% VO2max
 * within 2-3 weeks" attributed to Mujika & Padilla. The figure is in neither
 * abstract, the full texts are paywalled, and it could not be traced to
 * anything. It was written on 2026-08-06 with `verificationStatus:
 * numbers_from_secondary_sources` and no summary named — and the same entry
 * merged both parts of the review under Part II's URL, which is not what an
 * entry assembled from open papers looks like.
 *
 * So the number was not carried from a secondary source. It was produced, and
 * then labelled with the nearest status that sounded like diligence. The label
 * was invented by the same process as the figure.
 *
 * A reviewer reading `numbers_from_secondary_sources` treats it as weak
 * sourcing rather than as no sourcing, which is exactly the misreading that let
 * it ship. This check removes the option: a citation nobody has confirmed
 * against a primary record may not carry a quantity at all. Say what the paper
 * establishes in words, or verify it and quote it.
 *
 * Had it existed that day the library would have failed to load, and v0.3.3
 * would never have been built.
 */
function assertNoUnconfirmedFigures(item, where, field) {
  if (!UNCONFIRMED_STATUSES.includes(item.verificationStatus)) return;
  if (!/\d/.test(item.supports ?? "")) return;

  fail(
    `${where} ${field} "${item.citation}" is ${item.verificationStatus} — nobody here has ` +
      `checked it against a primary record — yet its "supports" states a figure: ` +
      `"${item.supports}". An unconfirmed citation may describe what a paper establishes, ` +
      `never quantify it. A number attached to a real journal reference reads as sourced to ` +
      `every reader who does not go and check.`
  );
}

/**
 * Every citation must say how far it has been read, in the vocabulary the
 * library declares.
 *
 * Optional was the wrong shape: an entry with no `verificationStatus` is
 * indistinguishable from one nobody has got to yet, and that is precisely the
 * entry a reader most needs flagged. Making it required turned up one — the
 * Javaloyes citation on EVD-R-002, which the 2026-08-07 provenance review never
 * touched — and it now declares `unverified` rather than declaring nothing.
 */
function assertVerifiable(item, where, field) {
  if (!item.verificationStatus) {
    fail(
      `${where} ${field} "${item.citation}" has no verificationStatus. ` +
        `Every citation must say how far anyone here has read it; "unverified" is a valid answer ` +
        `and an absent field is not, because the two are impossible to tell apart.`
    );
  }
  if (!VERIFICATION_STATUSES.includes(item.verificationStatus)) {
    fail(
      `${where} ${field} "${item.citation}" has verificationStatus "${item.verificationStatus}", ` +
        `which is not in the declared vocabulary [${VERIFICATION_STATUSES.join(", ")}]. ` +
        `A misspelt status reads as a verification claim nobody made.`
    );
  }
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
  const { studyDesign, recommendationStrength } = rule.evidence;

  if (rule.basis === "internal_composite") {
    if (rule.sources.length > 0) {
      fail(
        `${where} has basis "internal_composite" but lists ${rule.sources.length} source(s). ` +
          `A threshold on an Evidra-computed score cannot be supported by a publication that ` +
          `has never used that score. Move the citation to supportingLiterature and state what ` +
          `it does not support, or change the basis if the quantity is in fact externally defined.`
      );
    }
    if (recommendationStrength !== "internal_heuristic") {
      fail(
        `${where} has basis "internal_composite" but evidence.recommendationStrength ` +
          `"${recommendationStrength}". Without sources there is nothing for a publication to support.`
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
    if (recommendationStrength === "internal_heuristic") {
      fail(
        `${where} cites sources but claims evidence.recommendationStrength "internal_heuristic". ` +
          `Say how far those sources actually go toward the threshold.`
      );
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
    assertVerifiable(source, where, "source");
    assertNoUnconfirmedFigures(source, where, "source");
  }

  for (const item of rule.supportingLiterature ?? []) {
    if (!item.citation) fail(`${where} has supportingLiterature with no citation.`);
    if (!item.doesNotSupport) {
      fail(`${where} supportingLiterature "${item.citation}" must state what it does not support.`);
    }
    assertVerifiable(item, where, "supportingLiterature");
    assertNoUnconfirmedFigures(item, where, "supportingLiterature");
  }

  for (const item of rule.contested ?? []) {
    if (!item.citation || !item.objection) {
      fail(`${where} has a contested entry missing a citation or an objection.`);
    }
  }
}

/**
 * The two axes, and the tie between them.
 *
 * They are not independent at the bottom end: "no study supports this
 * threshold" and "the threshold rests on our own judgement" are the same
 * statement seen from either side, so a rule may not claim one without the
 * other. Allowing the pair `none` + `supports_threshold` would let a rule
 * assert that nothing supports its number and that its number is supported.
 */
function assertValidEvidence(rule, where) {
  const evidence = rule.evidence;
  if (!evidence || typeof evidence !== "object") {
    fail(
      `${where} has no evidence object. The single evidenceLevel field was split into ` +
        `evidence.studyDesign and evidence.recommendationStrength; evidenceLevel is now derived output ` +
        `and must not be declared by a rule.`
    );
  }
  if (!STUDY_DESIGNS.includes(evidence.studyDesign)) {
    fail(`${where} has evidence.studyDesign "${evidence.studyDesign}", which is not in the declared vocabulary.`);
  }
  if (!RECOMMENDATION_STRENGTHS.includes(evidence.recommendationStrength)) {
    fail(
      `${where} has evidence.recommendationStrength "${evidence.recommendationStrength}", ` +
        `which is not in the declared vocabulary.`
    );
  }

  const noDesign = evidence.studyDesign === "none";
  const noStrength = evidence.recommendationStrength === "internal_heuristic";
  if (noDesign !== noStrength) {
    fail(
      `${where} pairs studyDesign "${evidence.studyDesign}" with recommendationStrength ` +
        `"${evidence.recommendationStrength}". "none" and "internal_heuristic" are the same claim on ` +
        `two axes and must appear together or not at all.`
    );
  }

  if (evidence.recommendationStrength === "supports_threshold" && rule.sources?.length === 0) {
    fail(`${where} claims a study supports its threshold but cites none.`);
  }

  // `evidenceLevel` is derived, and session-rules.json does not declare it. It
  // is nonetheless present on a loaded rule, so a library that has been through
  // the loader once must survive being validated again — and a hand-written
  // copy that disagrees with the axes it summarises must not.
  const derived = deriveEvidenceLevel(evidence);
  if (rule.evidenceLevel !== undefined && rule.evidenceLevel !== derived) {
    fail(
      `${where} carries evidenceLevel "${rule.evidenceLevel}" but its evidence derives ` +
        `"${derived}". The flat field is a summary of the two axes and cannot contradict them; ` +
        `edit evidence, not the summary.`
    );
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

/**
 * A vocabulary the data declares and the code does not enforce is decoration.
 *
 * `session-rules.json` has always listed its own enums for a reader's benefit,
 * and nothing checked them against the enums the loader applies. The two could
 * drift in either direction: a value legal in the file and rejected by the
 * loader, or — worse — legal in the loader and absent from the list a reviewer
 * reads to learn what the values mean.
 */
function assertVocabulariesMatch(library) {
  const declared = {
    studyDesigns: STUDY_DESIGNS,
    recommendationStrengths: RECOMMENDATION_STRENGTHS,
    verificationStatuses: VERIFICATION_STATUSES,
    evidenceLevels: EVIDENCE_LEVELS
  };

  for (const [field, enforced] of Object.entries(declared)) {
    const inFile = library[field];
    if (!Array.isArray(inFile)) fail(`the library does not declare "${field}", so its vocabulary is undocumented.`);
    if (inFile.length !== enforced.length || inFile.some((value, index) => value !== enforced[index])) {
      fail(
        `the library declares "${field}" as [${inFile.join(", ")}] but the loader enforces ` +
          `[${enforced.join(", ")}]. A vocabulary a reviewer reads must be the vocabulary the loader applies.`
      );
    }
  }
}

export function assertValidRuleLibrary(library) {
  if (!SEMVER_PATTERN.test(library.version ?? "")) fail(`library version "${library.version}" is not semver.`);
  if (!Array.isArray(library.rules) || library.rules.length === 0) fail("library has no rules.");

  assertVocabulariesMatch(library);

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
    assertValidEvidence(rule, where);

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

export { CATEGORY_IDS, EVIDENCE_LEVELS, STUDY_DESIGNS, RECOMMENDATION_STRENGTHS, VERIFICATION_STATUSES, BASES };
