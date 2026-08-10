# Pacevera — Fitness Decision Engine

**Your AI assistant is the coach's brain and voice. Pacevera is the exercise science
and safety engine behind it.**

Pacevera is an MCP server. It turns the evidence you already have into a training
decision — not advice invented from nothing, but a change to the session already on
your calendar, with the evidence and the rule behind it.

It runs on your own machine, and it does not retain your evidence.

---

## Where this is

The current release is v0.4.2. v0.1.0 was the first public release.

The decision logic is covered by a deterministic test and evaluation suite:
under the same version of Pacevera, the same evidence produces the same decision,
and every decision cites the evidence and the rule behind it. It has not yet
been validated over extended real-world training blocks.

**You supply the evidence.** Pacevera does not connect to Apple Health, Garmin,
Strava, or any other service on your behalf, and it is not waiting for you to
link an account. It reads what you or your assistant hand it in the call —
which can be as ordinary as saying what you trained yesterday and how you
slept. If you already have exported data from those services, Pacevera can
evaluate that as input as well.

Signals you do not supply are reported in `signalCoverage` and lower the
decision's confidence. They are never filled in with defaults.

---

## Decision, not recommendation

This distinction is the whole product.

|  | Recommendation | **Decision** |
|---|---|---|
| Example | "You should do a Zone 2 run today" | "Today's VO₂max intervals become 45 min Zone 2" |
| Structure | Emitted from nothing | **A change to something that already exists** |
| Requires | Nothing | **Knowing what you were already going to do** |

A general-purpose model can produce the left column. It cannot produce the right one,
because the right one needs your plan, your recent load, and this morning's recovery —
and then needs the arithmetic done the same way every time.

Every decision comes back in five layers:

```
Evidence → Fitness State → Decision (intent) → Action (the change itself) → Reason (bound to evidence)
```

Decision types: `keep` (keeping the session is also a decision) · `adjust` ·
`substitute` · `defer` · `advance`

Intent and action are kept separate on purpose: the same intent becomes a different
action depending on your equipment, your schedule, and your injuries.

---

## How the work is divided

| Stage | Where | What happens |
|---|---|---|
| 1 | Pacevera | Normalize evidence from any source into one shape |
| 2 | Pacevera | Deterministic computation — `acwr = atl / ctl` is a division, not a prediction |
| 3 | Your AI assistant | Turn the structured result into plain language |

**Pacevera calls no model to produce a decision.** Under the same version of Pacevera,
identical inputs produce an identical decision, and every number is traceable. The
language you read is your assistant's; the judgment is arithmetic.

---

## Tools

| Tool | What it returns |
|---|---|
| `assess_fitness_state` | Today's recovery and training state. State only — it never says what to train. |
| `decide_session` | What today's scheduled session should become: keep it, ease it, or change it |
| `decide_exercise_substitution` | What to do instead of a movement you cannot do today |
| `generate_plan` | A plan, when you don't have one — the substrate decisions are made against |
| `preview_adjust_plan` | What adjusting a plan would change, without applying it |
| `commit_adjust_plan` | The plan a previewed adjustment produces, once you have accepted it — you keep it, Pacevera does not |

---

## Any single source works

You do not need to own a Garmin, an Apple Watch, and a Strava subscription.

- A runner with **only Strava** gets decisions from training load.
- Someone who **doesn't wear a watch to bed** gets decisions from HRV and their
  vendor's composite score.
- Someone who just **says it out loud** — "ran 45 minutes yesterday, slept about
  seven hours" — gets a decision from that.

This is the design, not a degraded mode. Every response reports which signals it had:

```json
"signalCoverage": {
  "recovery": { "usable": ["hrv"], "missing": ["sleep"] },
  "training": { "usable": ["trainingLoad"], "missing": [] }
}
```

- `recovery.missing` — no fresh reading today for sleep, HRV, resting heart rate, or stress
- `training.missing` — a session in the last 7 days arrived without a load figure

**Missing inputs are never filled in with defaults.** No RPE means no RPE, not 5. What's
missing is reported and confidence drops accordingly. A session without a load figure is
not counted as zero fatigue, because nobody said it was easy — it's reported as missing
instead, and `training.missing` is how you find out.

---

## Privacy Policy

Pacevera runs locally and does not retain your evidence.

> We process only the minimum health-related evidence submitted by the caller, solely to
> compute the requested fitness decision. We do not retain, sell, use for training, or use
> it for unrelated purposes.

As a desktop extension, this is checkable against the compiled server it ships: **Pacevera itself
performs no outbound network requests, does not persist your evidence, and has no
runtime dependencies, telemetry, model calls, or accounts.** Evidence exists in memory for the
duration of one tool call.

Full policy: [PRIVACY.md](PRIVACY.md)

Pacevera is not a medical device and does not provide medical advice. It is intended for
general fitness and training purposes only.

---

## Install

Pacevera ships as a Claude Desktop extension (`.mcpb`).

1. Download the latest `pacevera.mcpb` from [Releases](../../releases)
2. Check it against the published checksum (optional, and worth doing — see below)
3. Open **Claude Desktop → Settings → Extensions**
4. Install the `.mcpb` file
5. Ask a question that needs a decision — [six to start with](#six-questions-to-start-with)

**Requires Node.js 20 or newer.**

### Verifying what you downloaded

```
shasum -a 256 pacevera.mcpb
```

Compare it with the checksum printed in that release's notes, on the same page
you downloaded from.

An extension is a copy taken at install time. After installing a new version, restart
Claude Desktop completely — closing the window is not enough.

### Availability

| | Status |
|---|---|
| Claude Desktop (macOS / Windows) | Supported, via the extension above |
| Mobile, and other MCP hosts | Not yet — these need a remote server, which is not open to the public yet |

---

## Six questions to start with

Two need nothing but the sentence. The rest take whatever export you already have.

**1 · Nothing but what you can say out loud**

> I ran 80 minutes yesterday and felt pretty beaten up. Slept about six hours.
> Today's plan says VO₂max intervals, 60 minutes. Should I still do them?

Often comes back `keep`. Keeping the session is a decision — the evidence was
checked and it stands. Confidence will be low, and it says so.

**2 · Training load with no recovery signal at all**

> Here's my Strava export. Today is threshold repeats, 60 minutes hard — am I
> overcooking it?

Strava has no HRV and no sleep. Session load alone decides. Ask where the
threshold came from and you get the citation, the published objections to it,
and a plain statement that our cut point is not the one in the paper.

**3 · A vendor's own score, taken as it stands**

> Here's my Garmin data for today. I've got a tempo run scheduled, 50 minutes hard.

Body Battery, Oura Readiness and Whoop Recovery are used as they stand, never
recomputed, and weigh more than any raw reading.

v0.4.1 names that field in the tool schema, so an assistant can send a vendor
score as the vendor's own figure rather than falling back to the raw signals.
Sent that way it counts for more, and the confidence reported alongside the
decision reflects it.

**4 · Asking to go harder**

> Here's my Oura data. Today is an easy session but I feel great — can I push?

Decisions are not only downward — this one comes back `advance`. Oura reports no
training load, so Pacevera computes none rather than inventing a number.

The Oura and Whoop readers are the two youngest here. They were written against
those vendors' own published API specifications and have not yet been checked
against a real response from either service — and every reader before them turned
up something on real data that a specification did not mention. The Apple Health,
Garmin, Google Health and Strava readers were built from actual export files.

**5 · Training around an injury**

> My knee's been bothering me. What can I do instead of squats today? I've got a
> barbell, a squat rack and dumbbells.

Contraindicated movements are filtered out, not ranked down, and the reply names
the ones that were removed. The equipment matters to the example: with only
dumbbells to hand, the alternatives carrying a knee contraindication are already
gone for want of a barbell, and the filter has nothing left to do. A model can be
talked past a safety rule; a filter cannot.

**6 · The day it takes the session away**

> Here's my Whoop data for today. I've got VO₂max intervals scheduled, 60 minutes
> hard. Should I still do them?

This one comes back `defer`, and it is the type the other five never reach. The
scheduled session is not eased — it is replaced: focus, type, duration, intensity
and the movements themselves all change, and what you get instead is a recovery
walk and a mobility flow inside thirty minutes.

Confidence is high. Whoop does not measure stress, so that signal is reported
missing, and the decision still stands on three recovery signals plus the
vendor's own recovery score. An engine that only ever nudged would have nothing
to say on a day like this one. See the note under question 4 about how far the
Whoop reader has been checked.

Figures are not quoted here — what comes back depends on your evidence.

---

## Support

Bug reports and questions: [open an issue](../../issues)

Privacy requests, or anything you would rather not post publicly: **evidramcp@icloud.com**

---

## License

Proprietary — see [LICENSE](LICENSE). You may install and run Pacevera for your own use.
Copying, modifying, and redistributing it are not permitted.
