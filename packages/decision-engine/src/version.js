// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * The version of the code that applies the rules, kept apart from the version
 * of the rules themselves and from the version of the product they ship in.
 *
 * Three numbers move for three different reasons and had been collapsed into
 * two. `server.json` counts releases of the packaged extension, which change
 * for reasons that have nothing to do with a decision — a README fix, a
 * repacked archive, a manifest field. The rule library counts changes to the
 * thresholds and their provenance. Neither of those tells a caller whether the
 * arithmetic between a reading and a verdict changed, and that is the third
 * thing: arbitration order, how effects combine, how a rule's condition is
 * evaluated. Swapping the rule library without touching this file must be
 * possible, and a caller comparing two decisions needs to see which of the two
 * moved.
 *
 * Starts at 1.0.0 on 2026-08-08 alongside rule library 1.0.0. What each part
 * means here: major when a decision that fired before stops firing or changes
 * type on unchanged evidence, minor when the engine gains a capability without
 * changing existing verdicts, patch for anything a caller cannot observe.
 *
 * 1.1.0, the same day: the injury filter now fires EVD-R-009 and so enters
 * arbitration. No verdict moves — the same movements are removed as before —
 * but `decisionBasis.governingRule` does on any day a restriction bites, which
 * is observable and therefore not a patch.
 */
export const ENGINE_VERSION = "1.1.0";
