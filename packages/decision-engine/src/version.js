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
 *
 * 1.2.0, also the same day: a call with no scheduled session now carries
 * `decisionBasis` like every other decision, saying that no rule was applied
 * rather than saying nothing. It had been omitted entirely — a required field
 * on the tool's own output schema, absent on every such call, and invisible to
 * the golden set because its one decide_session case always supplies a session.
 * The decision itself is unchanged; what a caller receives is not, so this is a
 * minor rather than a patch. Found by the decision harness on its first run.
 *
 * 1.3.0, also the same day: a session targeting muscles with no training behind
 * them used to be told "target-muscle fatigue 0". Nothing measured that zero —
 * it is the starting value of the reducer that sums a week of load, surfaced
 * through `fatigue.value || 0`, and the group it named appears in neither
 * `evidence` nor `state.targetMuscleFatigue`. The sentence now says the target
 * muscles carry no load from the last week, which is what the coverage fields
 * were already saying underneath it. No verdict moves and no rule fires
 * differently; the prose a caller reads to the athlete does, so minor rather
 * than patch, by the same standard as 1.2.0 above. Found by the decision
 * harness once its scenarios stopped all targeting a trained muscle group.
 *
 * 1.4.0, also the same day: `describeRule` now emits `verificationStatus` on
 * every entry in a governing rule's `contested` list, and stops emitting `url`
 * there. The first half follows the library making that field mandatory, and on
 * its own would be announced well enough by libraryVersion moving to 2.0.0. The
 * second half would not: the identifiers are still in the library data and it is
 * this code that decided to leave them out of the frame, so a caller diffing two
 * decisions would see a field disappear with nothing in the library version to
 * explain it. No verdict moves and no rule fires differently; what a caller
 * receives does, which is the 1.2.0 standard.
 */
export const ENGINE_VERSION = "1.4.0";
