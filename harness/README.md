# Decision Harness

```bash
npm run harness
```

Fixed evidence in, the whole decision chain run once, and seven questions asked
of what comes out.

## Why this exists next to `eval/` and the package tests

Three things check decisions in this repo and they are not the same thing.

| | asks | fails when |
|---|---|---|
| `eval/` | is the tool's output shaped the way its contract says? | a field is missing, an id points at nothing, a plan is invalid |
| `packages/rules/test/regression.test.js` | does *this* evidence still fire *that* rule? | a threshold is widened, a rule stops governing |
| **this** | does the decision hold together at all? | a reason quotes a number nothing measured, a gap is filled instead of reported, an injury rule fires and something else is credited |

The structural difference is where the variation lives. A regression case is one
input with its own assertions, so the set of things being checked grows only
when someone writes new assertions. Here the assertions are fixed and the
scenarios are the variable: a scenario added tomorrow is put through all seven
checks without anyone editing `lib/checks.js`, and a check added to that file
applies retroactively to every scenario already written.

## The seven

| | question |
|---|---|
| DH-1 | Does the same evidence always produce the same decision — and does the chain leave the caller's evidence untouched? |
| DH-2 | Does every decision carry `from -> to`, and does `changed` say the truth about it? |
| DH-3 | Does every reason trace back to evidence, a stated threshold, or the session itself? |
| DH-4 | Is the decision attributed to the rule the arbitration policy says governs it? |
| DH-5 | Does a rule that fired and did not govern still leave a trace? |
| DH-6 | Does a missing signal lower confidence rather than get filled in? |
| DH-7 | Does an injury restriction really outrank recovery and training goal? |

And one more that is not an invariant at all:

| | question |
|---|---|
| DH-PIN | Does the decision still come out the way the scenario pins it? |

The seven above hold of any decision. DH-PIN holds of one: a scenario may carry
`expectedDecision`, and whatever fields it names are asserted — nothing more. It
is kept thin on purpose. Pinning an output catches every change to it, including
the changes that were right, so a fat pin turns each deliberate improvement into
a wall of diffs and teaches whoever reads them to update the expectations
without looking. The invariants are what should catch a decision going *wrong*;
this catches one going *different*, which is weaker and more fragile knowledge.

Read the pins for what they are: the current expectations were captured from a
verified run, not derived independently, so they lock in today's behaviour
rather than argue for it. The argument for a threshold lives in the rule
library; the argument for a rule still firing lives in
`packages/rules/test/regression.test.js`.

And two that are properties of the whole set rather than of any decision:

| | question |
|---|---|
| DH-COV | Is every active rule in the library reachable from a scenario? |
| DH-FP | Has any rule's threshold, category or effect moved without being acknowledged? |

DH-COV is what makes this a place a rule can be re-run, verified and traced,
rather than a sample of whichever rules the scenarios happened to hit. A rule
added to the library needs a scenario here, or the seven checks above keep
passing while saying nothing about it.

It overlaps `packages/rules/test/regression.test.js` only in name. That set pins
one rule per case against a hand-written state, which protects the threshold and
never asks the rule to survive a whole chain. This one asks whether the rule
still fires when the state it reads was computed from evidence rather than
written down — a rule can be intact and unreachable, and only a check that
starts from evidence can tell.

Two of them work by comparison rather than by inspection, because the thing they
are looking for is invisible from inside a single output.

**DH-1** runs each scenario a second time and compares, then runs it a third
time with the evidence deep-frozen. A fabricated value and a measured one look
identical in one decision; a value that changes between two identical calls does
not.

**DH-6** removes one recovery signal from the evidence and runs the scenario
again. The gap has to appear in `signalCoverage.recovery.missing`, the signal
has to stop being reported as usable, and confidence must not rise. It does not
assert that confidence *falls* — dropping one of four signals need not cross a
band boundary — only that taking evidence away never makes the system surer of
itself.

## Changing a rule

**A change to a threshold, a category or an effect has to be run through the
harness before it lands.** That is enforced, not requested:
`harness/rule-fingerprint.json` holds one digest per rule over exactly those
fields, and `npm test` fails while the library and the file disagree.

```bash
npm run harness                              # read what the decisions became
node harness/runner.js --update-fingerprint  # then acknowledge it
```

Regenerating is deliberately a second edit in a second file. The point is not
the hash — it is that the commit contains both the threshold that moved and the
record that somebody looked at what moved with it.

What the digest covers: `category`, `priority`, `thresholds`, `effect`,
`status`, plus the two policy ids. Prose is outside it on purpose — a guard that
went red for a corrected citation or a new limitation would be switched off
inside a week, and `harness/test/harness.test.js` pins both edges so the
boundary cannot drift.

`priority` is in there although it was not asked for, because arbitration is
`category_then_priority`: inside one category a priority edit moves which rule
the decision is attributed to exactly as a category edit does across them.

### What this adds over the rule regression set

Less than it first appears, and the difference is worth stating exactly rather
than overselling. `packages/rules/test/regression.test.js` builds each case to
sit just past its rule's cut point, so widening `acwrHigh` from 1.4 to 1.5 fails
that set immediately — measured, not assumed.

Two things it does not do. It covers seven of the nine rules; EVD-R-005 and
EVD-R-007 are deliberately excluded there, so a threshold edit on either is
caught by nothing else. And every one of its cases is a test, which means the
edit that widens the threshold can widen the case in the same commit: move
`acwrHigh` to 1.5 and the case's evidence to 1.51 and the whole suite goes green
with 416 passing tests. Measured, in this repo, on 2026-08-08. The fingerprint
is not a test of behaviour, so updating it is not something a failing test
invites you to do — it is a separate artifact, and it stays red until someone
changes it on purpose.

## Scope

Every check runs against `evidra_decide_session`'s chain and nothing else.

`evidra_generate_plan` and `evidra_decide_exercise_substitution` do not emit
`decisionBasis` — the server says so in its own `initialize` instructions, and
EVD-R-009's limitations record that the plan and the catalog run their own
injury filters by other mechanisms, carrying no rule id and passing through no
arbitration. So there is nothing on those two surfaces for DH-4, DH-5 or the
attribution half of DH-7 to read. Extending the decision trace to them is
separate work; this harness does not cover it and does not report on it either
way.

## Scenarios

`scenarios/*.json`, one per file, in Evidence shape — the same payload a caller
sends to `evidra_decide_session`, not the internal user context. That is
deliberate and it was wrong once: written as contexts, the injuries sat in a
field the tool never reads, so every restriction was silently absent and the
injury checks passed on scenarios that contained no injuries.

Both of those — the Evidence shape, and this directory sitting at the top level
rather than under `eval/` or `packages/` — were settled on 2026-08-08 and do not
need deriving again. The shape, for the reason above. The location, because
`packages/` holds libraries that `apps/` consumes and this consumes them
instead, and because a subdirectory of `eval/` reads as a subset of it when the
table above is the whole point. The cost of standing outside both is one line in
`.mcpbignore` that has to be remembered — `eval/` and `packages/` are already
listed there, this is not, and a harness packed into the archive would ship
thirteen files shaped exactly like a person's health record.

```json
{
  "id": "kebab-case, stable, used in output",
  "what": "why this scenario is in the set, in a sentence",
  "date": "2026-08-06",
  "scheduledSession": { },
  "proposedSession": { },
  "availableMinutes": 45,
  "expectedDecision": {
    "type": "adjust",
    "intent": "reduce_today_intensity",
    "governingRule": "EVD-R-002",
    "firedRules": ["EVD-R-002"],
    "changed": ["focus", "intensity"],
    "to": { "intensity": "moderate", "durationMinutes": 60 }
  },
  "evidence": { "profile": {}, "goals": [], "constraints": {}, "workouts": [], "healthMetrics": [] }
}
```

`id`, `date` and `evidence` are required. `scheduledSession` may be `null` —
that is the scenario for the product's central distinction, where there is no
prior state and therefore no decision to make.

`expectedDecision` is optional and so is every field inside it. A scenario that
pins only `type` is making only that claim, and DH-PIN says nothing about the
rest. A scenario with no `expectedDecision` at all is still fully checked by the
seven invariants — the pin is an addition to them, never a substitute.

## Keeping it honest

`lib/chain.js` reproduces what `decideSessionTool` does before the engine is
called — semantic state, the impulse-response ratio that supersedes the crude
one, canonical movement ids. A copy drifts, and a harness quietly checking a
pipeline that no longer resembles the shipped one is worse than no harness, so
`test/harness.test.js` runs one scenario through both paths and asserts the
decision, the action, the reasons and the governing rule come out the same.
