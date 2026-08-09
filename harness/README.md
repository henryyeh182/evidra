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

And three that are properties of the whole set rather than of any decision:

| | question |
|---|---|
| DH-COV | Is every rule the session engine applies reachable from a scenario? |
| DH-BND | Is every threshold exercised at its edge, and quiet one step short of it? |
| DH-FP | Has any rule's threshold, category or effect moved without being acknowledged? |

DH-COV is what makes this a place a rule can be re-run, verified and traced,
rather than a sample of whichever rules the scenarios happened to hit. A rule
added to the library needs a scenario here, or the seven checks above keep
passing while saying nothing about it.

DH-BND asks the same question of the *number* rather than the rule, and is
documented in [Straddling a threshold](#straddling-a-threshold) below. A rule
can be covered and its threshold still free to move: every scenario that fired
EVD-R-004 sat at a fatigue in the eighties, so 65 could have become 55 or 75
and nothing here would have gone red.

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

**DH-6** ablates every kind of evidence the session state reads and runs the
scenario again. It removes raw recovery metrics, vendor composites, and one
recent training load; it also repeats the recovery ablation with the reading
made stale rather than deleted. Raw signals must appear in
`signalCoverage.recovery.missing`; vendor composites must stop being usable and
must not leave a fabricated readiness value; training load must appear in
`signalCoverage.training.missing`. In every case confidence must not rise. It
does not assert that confidence *falls* — removing one signal need not cross a
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

`evidra_generate_plan`, the plan change tools and
`evidra_decide_exercise_substitution` do emit `decisionBasis` as of 2026-08-09,
against EVD-R-010, EVD-R-011 and EVD-R-012 — but not from a chain this harness
can drive: each needs a plan or a catalog lookup rather than a day of evidence.
So DH-COV and DH-BND are scoped to `appliedBy === "session"`, and the rules
outside that scope are exercised in `apps/mcp-server/test/ruleCoverage.test.js`,
which fails in the same way if one of them ships unexercised. Bringing those
surfaces into the harness itself is
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
`.mcpbignore` that has to be remembered — it is line 28 there, alongside `eval/`
and `packages/`, and a harness packed into the archive would ship thirty-one
files shaped exactly like a person's health record.

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
    "overruledRules": [],
    "changed": ["focus", "intensity"],
    "to": { "intensity": "moderate", "durationMinutes": 60 },
    "confidence": "high",
    "signalCoverage": { "recovery": { "missing": [] } }
  },
  "rulePosition": [
    { "rule": "EVD-R-002", "threshold": "readinessReduce", "position": "triggers" }
  ],
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

`overruledRules` is derived rather than read: `decisionBasis` carries no such
field, and the information is in what it does carry — every rule in
`appliedRules` that is not the governing one lost arbitration. It is pinned
separately from `firedRules` because a rule can keep firing while quietly
changing sides, and "fired" alone would not show it.

`confidence` and `signalCoverage` are pinned by the four scenarios whose subject
they are — 32 through 35, where a signal is deliberately absent — and by nothing
else. DH-6 asks the general question of every scenario: a signal taken away has
to be reported and must never make the system surer of itself. What it cannot
say is which signals *this* scenario is short of, or what confidence that
shortfall lands on, because nothing was taken away from a scenario that was
already thin. An engine that promoted a three-signal day to `high` would pass
DH-6 in full.

Both are named group by group and list by list, so a scenario claiming
`recovery.missing` claims that and nothing about the training half, and the
lists are sorted before comparing — the order they come out in is the order the
signals happen to be enumerated in, and no scenario should be pinning that.

`rulePosition` is what DH-BND reads, and is described next.

## Straddling a threshold

A scenario says where it sits relative to a rule's threshold, and three
positions are available:

| | the reading | and then |
|---|---|---|
| `triggers` | on the acting side | the rule acts |
| `boundary` | **exactly** the threshold value | acts or not — the *operator* decides, not the scenario |
| `just_below` | on the non-acting side, within one step | the rule stays quiet |

That `boundary` does not say whether it fires is the point. `>= 90` acts at 90
and `> 1.4` does not act at 1.4, so a scenario allowed to assert its own
outcome could assert the wrong half of its own rule; DH-BND derives it from the
library instead. For the same reason `just_below` is required only where the
operator admits equality — on `<` and `>` the reading at the value is already
the non-acting one, and asking for a third case would be asking for the same
scenario twice.

"Within one step" is what makes `just_below` a claim rather than a label. The
step comes from the threshold's unit (1 for a score, 0.01 for a ratio), and a
unit with no declared step is an error rather than a default, because a guessed
step size silently widens every straddle written against it.

Every number in these scenarios was found by searching the real chain for a
reading that lands on the value, not chosen by eye. That is the opposite of
fitting a threshold to data and must not be mistaken for it: the thresholds are
fixed and the evidence is bent to meet them, which is what a boundary test is.
Nothing here is evidence *for* a cut point — that argument lives in the rule
library, and for most of these rules it is `internal_composite`, meaning there
is none.

### Proving a silence

A scenario that does not fire a rule proves nothing on its own. On a rule with
more than one threshold the silence may be some *other* condition failing, and
from outside the two are identical.

So every non-acting claim is made to prove itself: the same scenario is re-run
with that one quantity pushed across the line and nothing else touched, and if
the rule still does not act, the scenario is not testing what it says it tests.
This is DH-6's ablation run in the other direction, and it is the only use of
`runChain`'s `overrideState` — a scenario cannot reach it, so an
evidence-driven harness cannot be turned into a state-driven one by writing a
scenario file.

Two of EVD-R-009's quantities are not fields of the state at all — the count of
movements a restriction strikes out is computed inside the engine from two
things the state does not hold — so those declarations name a sibling scenario
in `provedBy` instead. Weaker, and visibly so: two scenarios can differ in more
than one thing. The pair here differ in one word of one restriction.

### Where the numbers are read from

`lib/quantities.js` says, for every threshold in the library, where its quantity
is read from and how to move it. It exists because a rule that did not fire
records nothing in `decisionBasis`, so there is nowhere else to get the reading
for the half of these scenarios where the rule stayed quiet.

That is a second copy of what the engine measures, and it is guarded rather than
denied: where a rule publishes the same quantity in its recorded reading,
DH-BND compares the two and fails if they disagree. Where it does not — a rule
records one reading, and EVD-R-009's is the movement count, so nothing in the
record corresponds to the token length its second threshold cuts — the
cross-check is skipped rather than pointed at whichever number happens to be
there.

`gates` in that file separates three things that look alike in the library and
are not:

- **firing** — crossing it decides whether the rule fires.
- **severity** — the rule fires either side; crossing it decides how hard it
  pushes. Both of EVD-R-007's thresholds are this. What decides whether that
  rule fires at all is `detraining.active`, computed in
  `packages/training-load/src/trainingLoad.js` from two bare constants — 14 idle
  days and a 25% chronic-load loss — which are not in the rule library, carry no
  provenance, and appear in no `decisionBasis`.
- **effect** — a cap or a multiplier applied *after* the rule fires. There is no
  side to be on, and a straddle declared against one is rejected.

One threshold is exempt from having an edge, and the exemption costs a written
reason that prints on every run. EVD-R-007's 42-idle-day arm is collinear with
its 60%-chronic-loss arm: chronic load decays on a fixed curve once training
stops, and measured against `computeTrainingLoad` on blocks of 3 and 12 sessions
at loads of 30, 60 and 90, 38 idle days already gives exactly 60% lost, 41 gives
63% and 42 gives 63–64%. `severe` is therefore true four days before the 42-day
threshold is reached, and that number could hold any value above about 39
without changing a decision. A scenario at 42 days would pass while proving
nothing, which is worse than the exemption.

## What the arbitration policy claims, and what a scenario can show

`category_then_priority` sorts on three keys — category rank ascending, then
priority descending, then ruleId. **Only the middle one can be reached from
evidence.** Measured on 2026-08-08 against library v1.1.0 and
`packages/decision-engine/src/decideSession.js`, and recorded here because a
scenario set that covers every rule reads as though it covered every claim the
policy makes.

**Category ahead of priority: unreachable.** Exactly one pair of active rules has
the two keys disagreeing — EVD-R-005 (`recovery`, priority 20) against
EVD-R-008 (`training_goal`, priority 40) — and the chain cannot fire both.
EVD-R-008 requires `type === "keep"` at the point it is tested
(`decideSession.js:609`), and every other rule in the library escalates the type
when it fires; EVD-R-005 is the one that does not, and it requires target-muscle
fatigue `>= 45` with a planned intensity of `high`, both of which EVD-R-008's own
conditions (`< 45`, and `!== "high"`) exclude. So `training_goal` never appears
alongside another category at all, and no scenario written here can show category
rank overriding a higher priority. `packages/rules/test/rules.test.js` does
assert it — on `arbitrate` directly, with the pair the chain cannot produce.
That is the sorter being tested, not the decision.

**ruleId last: unreachable.** No two active rules share a category and a
priority, so the tiebreak never runs. It orders nothing today, and a rule added
with a priority already in use would be the first thing to reach it.

**Priority ahead of ruleId: shown.** That is
`30-priority-orders-three-recovery-rules`, where the rule the engine reaches
first and which holds the lowest ruleId of the three fired — EVD-R-002 — governs
nothing.

Two more shapes of the library narrow what "several rules at once" can mean, and
neither is visible from the rule data:

- **EVD-R-001 never competes.** It sits in the `if` of an `if`/`else`
  (`decideSession.js:440`) whose `else` holds EVD-R-002 through EVD-R-007, so
  the highest-priority recovery rule in the library is the one recovery rule that
  cannot be arbitrated against another. It can share a decision only with
  EVD-R-009.
- **EVD-R-003, EVD-R-004 and EVD-R-005 are `else if` on one quantity**, so at
  most one of the three fires however high target-muscle fatigue reads.

What is left, and what the two arbitration scenarios use: EVD-R-002, one of
EVD-R-003/004/005, EVD-R-006 and EVD-R-007 may fire together, and EVD-R-009 may
fire with any of them.

The second of the two is there for the other policy.
`31-an-injury-governs-what-recovery-sizes` has EVD-R-009 governing on category
while demanding no intensity step, and the two steps the session comes down are
EVD-R-003's — a rule that lost. `most_restrictive_wins` states that the
governing rule explains the decision without necessarily setting the size of the
change, and until that scenario the two were never separated: every other
multi-rule case in this set has the governing rule and the largest demand
belonging to the same rule.

## Keeping it honest

`lib/chain.js` reproduces what `decideSessionTool` does before the engine is
called — semantic state, the impulse-response ratio that supersedes the crude
one, canonical movement ids. A copy drifts, and a harness quietly checking a
pipeline that no longer resembles the shipped one is worse than no harness, so
`test/harness.test.js` runs one scenario through both paths and asserts the
decision, the action, the reasons and the governing rule come out the same.
