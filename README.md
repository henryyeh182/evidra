# Evidra — Fitness Decision Engine

**Your AI assistant is the coach's brain and voice. Evidra is the exercise science
and safety engine behind it.**

Evidra is an MCP server. It turns the evidence you already have into a training
decision — not advice invented from nothing, but a change to the session already on
your calendar, with the evidence and the rule behind it.

It runs on your own machine, and it does not retain your evidence.

---

## Where this is

The current release is v0.3.7. v0.1.0 was the first public release.

The decision logic is covered by a deterministic test and evaluation suite:
under the same version of Evidra, the same evidence produces the same decision,
and every decision cites the evidence and the rule behind it. It has not yet
been validated over extended real-world training blocks.

**You supply the evidence.** Evidra does not connect to Apple Health, Garmin,
Strava, or any other service on your behalf, and it is not waiting for you to
link an account. It reads what you or your assistant hand it in the call —
which can be as ordinary as saying what you trained yesterday and how you
slept. If you already have exported data from those services, Evidra can
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
| 1 | Evidra | Normalize evidence from any source into one shape |
| 2 | Evidra | Deterministic computation — `acwr = atl / ctl` is a division, not a prediction |
| 3 | Your AI assistant | Turn the structured result into plain language |

**Evidra calls no model to produce a decision.** Under the same version of Evidra,
identical inputs produce an identical decision, and every number is traceable. The
language you read is your assistant's; the judgment is arithmetic.

---

## Tools

| Tool | What it returns |
|---|---|
| `evidra_assess_fitness_state` | Today's recovery and training state. State only — it never says what to train. |
| `evidra_decide_session` | What today's scheduled session should become: keep it, ease it, or change it |
| `evidra_decide_exercise_substitution` | What to do instead of a movement you cannot do today |
| `evidra_generate_plan` | A plan, when you don't have one — the substrate decisions are made against |
| `evidra_preview_adjust_plan` | What adjusting a plan would change, without applying it |
| `evidra_commit_adjust_plan` | The plan a previewed adjustment produces, once you have accepted it — you keep it, Evidra does not |

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

Evidra runs locally and does not retain your evidence.

> We process only the minimum health-related evidence submitted by the caller, solely to
> compute the requested fitness decision. We do not retain, sell, use for training, or use
> it for unrelated purposes.

As a desktop extension, this is checkable against the compiled server it ships: **Evidra itself
performs no outbound network requests, does not persist your evidence, and has no
runtime dependencies, telemetry, model calls, or accounts.** Evidence exists in memory for the
duration of one tool call.

Full policy: [PRIVACY.md](PRIVACY.md)

Evidra is not a medical device and does not provide medical advice. It is intended for
general fitness and training purposes only.

---

## Install

Evidra ships as a Claude Desktop extension (`.mcpb`).

1. Download the latest `evidra.mcpb` from [Releases](../../releases)
2. Check it against the published checksum (optional, and worth doing — see below)
3. Open **Claude Desktop → Settings → Extensions**
4. Install the `.mcpb` file
5. Ask a question that needs a decision — [five to start with](#five-questions-to-start-with)

**Requires Node.js 20 or newer.**

### Verifying what you downloaded

```
shasum -a 256 evidra.mcpb
```

Compare it against the `fileSha256` published for that version in the
[MCP registry](https://registry.modelcontextprotocol.io/v0/servers?search=evidra),
under `io.github.henryyeh182/evidra`.

Two things make that check worth the minute it takes. The checksum is held by a
registry we do not control, so it is not us vouching for ourselves. And **every
release from v0.1.0 onward is kept and never overwritten**, so a build you
verified last year still verifies today — the file you checked is the file that
stays at that URL.

An extension is a copy taken at install time. After installing a new version, restart
Claude Desktop completely — closing the window is not enough.

### Availability

| | Status |
|---|---|
| Claude Desktop (macOS / Windows) | Supported, via the extension above |
| Mobile, and other MCP hosts | Not yet — these need a remote server, which is not open to the public yet |

---

## Five questions to start with

Two of these need nothing but the sentence. The other three want whatever export
you already have — Evidra reads what your assistant hands it, so "attach my
Strava export" and "here is what I did yesterday" are the same kind of input.

**Figures are deliberately not quoted below.** What comes back depends on your
evidence, and a number printed here would be a number from someone else's body.
What is fixed is the *kind* of answer, and that every one of them arrives with
the evidence and the rule attached.

**1 · Nothing but what you can say out loud**

> I ran 80 minutes yesterday and felt pretty beaten up. Slept about six hours.
> Today's plan says VO₂max intervals, 60 minutes. Should I still do them?

Often this comes back `keep` — and that is the point. Keeping the session is a
decision, not the absence of one: it means the evidence was checked and the
session stands. Confidence will be low, because one sleep figure is most of what
you gave it, and it will say so rather than sounding sure.

**2 · Training load with no recovery signal at all**

> Here's my Strava export. Today is threshold repeats, 60 minutes hard — am I
> overcooking it?

Strava measures no HRV and no sleep. It has the load of every session, and that
alone decides. If your recent load has climbed too fast against the preceding
weeks, the intensity comes down and the rule that did it is named. With only a
little history the comparison falls back to an assumed weekly target instead of
your own past, and the response says which of the two it used. Ask where
its threshold came from and you get the citation, **plus the published objections
to that citation**, plus a plain statement that our cut point is not the one in
the paper.

**3 · A vendor's own score, taken as it stands**

> Here's my Garmin data for today. I've got a tempo run scheduled, 50 minutes hard.

Body Battery, Oura Readiness and Whoop Recovery are treated as first-class
evidence and are **not recomputed**. The watch was on your wrist; it integrated
signals Evidra never sees. Supply one and it weighs more than the raw readings —
and confidence rises, because less is missing.

**4 · Asking to go harder**

> Here's my Oura data. Today is an easy session but I feel great — can I push?

Decisions are not only downward. With recovery high and the target muscles fresh,
this comes back `advance`, and the session moves up. Oura reports no training
load, so **Evidra computes none** — it will not multiply duration by an intensity
label to manufacture a number that later turns into "take it easy today".

**5 · Training around an injury**

> My knee's been bothering me. What can I do instead of squats today? I've only
> got dumbbells and bodyweight.

Movements contraindicated for the knee are **filtered out, not ranked down**. The
reason you get back says so in as many words. A model can be talked past a safety
rule; a deterministic filter cannot.

---

## Support

Bug reports and questions: [open an issue](../../issues)

Privacy requests, or anything you would rather not post publicly: **evidramcp@icloud.com**

---

## License

Proprietary — see [LICENSE](LICENSE). You may install and run Evidra for your own use.
Copying, modifying, and redistributing it are not permitted.
