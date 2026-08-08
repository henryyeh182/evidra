// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import test from "node:test";
import assert from "node:assert/strict";

import {
  getRuleLibrary,
  getRule,
  describeRule,
  arbitrate,
  combineIntensitySteps,
  THRESHOLDS,
  assertValidRuleLibrary,
  assertThresholdsMatch,
  deriveEvidenceLevel,
  EVIDENCE_LEVELS,
  STUDY_DESIGNS,
  RECOMMENDATION_STRENGTHS,
  VERIFICATION_STATUSES
} from "../src/index.js";

const library = getRuleLibrary();
const clone = () => JSON.parse(JSON.stringify(library));

test("the shipped library satisfies its own invariants", () => {
  assert.doesNotThrow(() => assertValidRuleLibrary(clone()));
});

// The invariant this library exists for. A citation attached to a threshold on
// an Evidra-computed score would read as evidence-based to anyone who did not
// check it, and would not survive anyone who did — the paper never mentions the
// score. So the check is structural, not editorial.
test("a citation cannot be attached to a threshold on a score Evidra invents", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "internal_composite");
  rule.sources.push({
    citation: "A real paper about readiness.",
    supports: "Readiness matters.",
    doesNotSupport: "Nothing."
  });

  assert.throws(
    () => assertValidRuleLibrary(tampered),
    /internal_composite.*source/is,
    "an internal_composite rule carrying a source must fail the load"
  );
});

test("an internal_composite rule cannot claim a study supports its threshold", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "internal_composite");
  rule.evidence.recommendationStrength = "supports_direction_only";
  delete rule.evidenceLevel;

  assert.throws(() => assertValidRuleLibrary(tampered), /recommendationStrength/i);
});

// The two axes are independent everywhere except at the bottom, where they are
// the same statement twice. `none` + `supports_threshold` would have a rule
// assert that nothing supports its number and that its number is supported.
test("no study and a supported threshold cannot be claimed together", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.evidence.studyDesign === "none");
  rule.evidence.recommendationStrength = "supports_threshold";
  delete rule.evidenceLevel;

  assert.throws(() => assertValidRuleLibrary(tampered), /same claim on two axes/i);
});

test("a study design outside the declared vocabulary fails the load", () => {
  const tampered = clone();
  tampered.rules[0].evidence.studyDesign = "meta_analysis";
  delete tampered.rules[0].evidenceLevel;

  assert.throws(() => assertValidRuleLibrary(tampered), /studyDesign/);
});

// The flat field is a summary, and a summary that can disagree with what it
// summarises is worse than no summary: a caller reading only `evidenceLevel`
// would be reading a claim nothing enforces.
test("the compatibility field cannot contradict the axes it summarises", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.evidence.studyDesign === "none");
  rule.evidenceLevel = "systematic_review";

  assert.throws(() => assertValidRuleLibrary(tampered), /cannot contradict/i);
});

test("the old evidence ladder is reproduced exactly for every shipped rule", () => {
  // The point of keeping `evidenceLevel` is that nothing downstream has to
  // change. If a derivation ever moved one of these, that promise is broken.
  const expected = {
    "EVD-R-001": "internal_heuristic",
    "EVD-R-002": "internal_heuristic",
    "EVD-R-003": "internal_heuristic",
    "EVD-R-004": "internal_heuristic",
    "EVD-R-005": "internal_heuristic",
    "EVD-R-006": "observational",
    "EVD-R-007": "expert_consensus",
    "EVD-R-008": "internal_heuristic"
  };

  for (const rule of library.rules) {
    assert.equal(rule.evidenceLevel, expected[rule.ruleId], `${rule.ruleId} changed its compatibility level`);
    assert.ok(EVIDENCE_LEVELS.includes(rule.evidenceLevel), `${rule.ruleId} derived a level outside the old ladder`);
  }
});

// The one lossy step in the collapse, pinned so it stays deliberate. EVD-R-007
// is two narrative reviews; the old ladder has no rung for that and rounds to
// expert_consensus, which is the rounding the rule was doing by hand before
// the axis existed.
test("narrative_review collapses to expert_consensus and nothing else does", () => {
  assert.equal(
    deriveEvidenceLevel({ studyDesign: "narrative_review", recommendationStrength: "supports_direction_only" }),
    "expert_consensus"
  );
  assert.equal(
    deriveEvidenceLevel({ studyDesign: "rct", recommendationStrength: "supports_direction_only" }),
    "rct"
  );
  assert.equal(
    deriveEvidenceLevel({ studyDesign: "none", recommendationStrength: "internal_heuristic" }),
    "internal_heuristic"
  );

  const lossy = STUDY_DESIGNS.filter(
    (design) =>
      design !== "none" &&
      deriveEvidenceLevel({ studyDesign: design, recommendationStrength: "supports_direction_only" }) !== design
  );
  assert.deepEqual(lossy, ["narrative_review"], "a second lossy collapse appeared without anyone deciding to add one");
});

// R5. The vocabulary was written into readMe on 2026-08-07 and enforced by
// nobody, so a typo in this field would have read as a verification claim. It
// is the one field in the library that is a statement about our own diligence
// rather than about the athlete or the literature.
test("every citation in the library declares how far it has been read", () => {
  for (const rule of library.rules) {
    for (const source of rule.sources) {
      assert.ok(
        VERIFICATION_STATUSES.includes(source.verificationStatus),
        `${rule.ruleId} source "${source.citation}" has no valid verificationStatus`
      );
    }
    for (const item of rule.supportingLiterature ?? []) {
      assert.ok(
        VERIFICATION_STATUSES.includes(item.verificationStatus),
        `${rule.ruleId} supportingLiterature "${item.citation}" has no valid verificationStatus`
      );
    }
  }
});

test("a citation with no verificationStatus fails the load", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.sources.length > 0);
  delete rule.sources[0].verificationStatus;

  assert.throws(() => assertValidRuleLibrary(tampered), /no verificationStatus/i);
});

test("a misspelt verificationStatus fails the load", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.sources.length > 0);
  rule.sources[0].verificationStatus = "primary_fulltext_verified";

  assert.throws(() => assertValidRuleLibrary(tampered), /not in the declared vocabulary/i);
});

// supportingLiterature was the field with the hole: EVD-R-002's citation was
// the only entry in the library carrying no status at all, because the
// 2026-08-07 review never reached it. Both fields are checked, not just
// `sources`.
test("supportingLiterature is held to the same standard as sources", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.supportingLiterature?.length > 0);
  delete rule.supportingLiterature[0].verificationStatus;

  assert.throws(() => assertValidRuleLibrary(tampered), /supportingLiterature.*no verificationStatus/is);
});

// The regression this library exists for, using the entry that actually shipped.
//
// Written 2026-08-06, released in v0.3.3 through v0.3.7, retracted 2026-08-07:
// the figure is in neither abstract, the full texts are paywalled, and it could
// not be traced to any summary either. It carried a real journal reference and a
// status that reads as weak sourcing rather than none, which is what let five
// releases go out with it. Verbatim below so the case cannot be softened into a
// tidier example than the one that happened.
test("a citation nobody confirmed cannot carry a number — the EVD-R-007 case", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.ruleId === "EVD-R-007");
  rule.sources = [
    {
      citation:
        "Mujika I, Padilla S. Detraining: loss of training-induced physiological and performance adaptations. " +
        "Part I: short term insufficient training stimulus / Part II: long term insufficient training stimulus. " +
        "Sports Med. 2000;30(2):79-87 and 30(3):145-154.",
      url: "https://pubmed.ncbi.nlm.nih.gov/10999420/",
      supports:
        "That aerobic capacity declines progressively with training cessation — roughly 4-7% VO2max within " +
        "2-3 weeks, substantially more beyond 4 weeks — so a returning athlete should not resume at prior load, " +
        "and the reduction should scale with the length of the break.",
      doesNotSupport: "The specific values 42 days, 60%, and 0.6.",
      verificationStatus: "numbers_from_secondary_sources"
    }
  ];
  delete rule.evidenceLevel;

  assert.throws(
    () => assertValidRuleLibrary(tampered),
    /states a figure/i,
    "the library must refuse to load rather than ship an unconfirmed number attached to a real paper"
  );
});

test("a confirmed citation may still quote the figures it verified", () => {
  // The check has to distinguish "nobody looked" from "someone looked and this
  // is what it said" — otherwise the honest fix is to delete the evidence.
  assert.doesNotThrow(() => assertValidRuleLibrary(clone()));

  const gabbett = getRule("EVD-R-006").sources[0];
  assert.equal(gabbett.verificationStatus, "primary_full_text_verified");
  assert.match(gabbett.supports, /0\.8-1\.3/, "a verified citation keeps the numbers it verified");
});

test("the unchecked citation says so rather than saying nothing", () => {
  const rule = getRule("EVD-R-002");

  assert.equal(rule.supportingLiterature[0].verificationStatus, "unverified");
  assert.ok(
    rule.limitations.some((line) => line.includes("unverified")),
    "an unverified citation must be visible in limitations, not only in a field a reader may not know to check"
  );
});

// A vocabulary the file declares and the loader does not apply is decoration,
// and the drift can run either way: a value legal in the file and rejected by
// the loader, or legal in the loader and missing from the list a reviewer reads
// to learn what the values mean.
test("the vocabularies the file declares are the vocabularies the loader enforces", () => {
  assert.deepEqual(library.studyDesigns, STUDY_DESIGNS);
  assert.deepEqual(library.recommendationStrengths, RECOMMENDATION_STRENGTHS);
  assert.deepEqual(library.verificationStatuses, VERIFICATION_STATUSES);
  assert.deepEqual(library.evidenceLevels, EVIDENCE_LEVELS);
});

test("a vocabulary that drifts from the loader fails the load", () => {
  const tampered = clone();
  tampered.verificationStatuses = [...tampered.verificationStatuses, "eyeballed"];

  assert.throws(() => assertValidRuleLibrary(tampered), /must be the vocabulary the loader applies/i);
});

// Every citation in this library falls short of the threshold it is attached to
// in some way. Forcing `doesNotSupport` to be filled in means the shortfall has
// to be stated rather than left for a reader to discover.
test("a source must say what it does not support", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.sources.length > 0);
  delete rule.sources[0].doesNotSupport;

  assert.throws(() => assertValidRuleLibrary(tampered), /does NOT support/i);
});

test("an external_metric rule cannot ship without a source", () => {
  const tampered = clone();
  const rule = tampered.rules.find((entry) => entry.basis === "external_metric");
  rule.sources = [];

  assert.throws(() => assertValidRuleLibrary(tampered), /no sources/i);
});

test("a rule with no limitations has not been reviewed", () => {
  const tampered = clone();
  tampered.rules[0].limitations = [];

  assert.throws(() => assertValidRuleLibrary(tampered), /limitations/i);
});

// Both directions, because either one alone lets the library drift into
// decoration: a number nobody declares, or a rule nobody applies.
test("a threshold the engine applies but no rule declares fails the load", () => {
  assert.throws(
    () => assertThresholdsMatch(library, [...Object.keys(THRESHOLDS), "someNewNumber"]),
    /no rule declares/i
  );
});

test("a rule the engine never reads fails the load", () => {
  assert.throws(
    () => assertThresholdsMatch(library, Object.keys(THRESHOLDS).slice(1)),
    /never reads/i
  );
});

test("arbitration puts category before priority", () => {
  // EVD-R-008 is training_goal with priority 40; EVD-R-005 is recovery with
  // priority 20. Priority alone would pick 008; category rank must not let it.
  const { governing, overruled } = arbitrate(["EVD-R-008", "EVD-R-005"]);

  assert.equal(governing.ruleId, "EVD-R-005", "a lower-priority recovery rule still outranks a training-goal rule");
  assert.deepEqual(
    overruled.map((entry) => entry.ruleId),
    ["EVD-R-008"]
  );
});

test("arbitration is stable for the same inputs in any order", () => {
  const a = arbitrate(["EVD-R-002", "EVD-R-006", "EVD-R-004"]);
  const b = arbitrate(["EVD-R-004", "EVD-R-002", "EVD-R-006"]);

  assert.deepEqual(a.ordered.map((entry) => entry.ruleId), b.ordered.map((entry) => entry.ruleId));
});

// Two devices reporting the same tired athlete is one fact observed twice.
// Summing the reductions would penalise a well-instrumented user for having
// more sensors.
test("intensity reductions do not sum", () => {
  assert.equal(combineIntensitySteps([1, 1, 1]), 1);
  assert.equal(combineIntensitySteps([1, 2]), 2);
});

test("a progression can never cancel a reduction", () => {
  assert.equal(combineIntensitySteps([1, -1]), 1);
  assert.equal(combineIntensitySteps([-1]), -1);
});

test("the compact rule form keeps basis and evidence level", () => {
  // These fields are the disclosure. If size pressure ever trims the compact
  // form further, it must not trim these — including the two axes, since
  // "observational" alone does not say whether the study reaches our number.
  const compact = describeRule("EVD-R-006", { value: 2.1 }, { full: false });

  assert.equal(compact.basis, "external_metric");
  assert.equal(compact.evidenceLevel, "observational");
  assert.deepEqual(compact.evidence, {
    studyDesign: "observational",
    recommendationStrength: "supports_direction_only"
  });
  assert.ok(compact.contestedCount > 0, "the compact form still says objections exist");
  assert.equal(compact.sources, undefined, "the compact form does not carry full citations");
});

test("the acute:chronic rule ships its own published objections", () => {
  const rule = getRule("EVD-R-006");
  const described = describeRule("EVD-R-006");

  assert.ok(rule.sources.length > 0);
  assert.ok(
    described.contested.length >= 2,
    "citing Gabbett without citing the published criticism would misrepresent the field"
  );
  assert.ok(
    described.limitations.some((line) => line.includes("1.4")),
    "the limitation that our threshold is not the literature's must be stated"
  );
});

test("every threshold in the library is reachable from a rule that owns it", () => {
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    const owner = library.rules.find((rule) => rule.thresholds.some((entry) => entry.key === key));
    assert.ok(owner, `${key} has no owning rule`);
    const threshold = owner.thresholds.find((entry) => entry.key === key);
    assert.equal(threshold.value, value, `${key} disagrees with the value the engine reads`);
  }
});
