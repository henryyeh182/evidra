# Evidra — Fitness Decision Engine

**Your AI assistant is the coach's brain and voice. Evidra is the exercise science
and safety engine behind it.**

Evidra is an MCP server. It turns the evidence you already have into a training
decision — not advice invented from nothing, but a *from → to* change against the
session already on your calendar, with the evidence and the rule behind it.

It runs on your own machine. It stores nothing.

---

## Decision, not recommendation

This distinction is the whole product.

|  | Recommendation | **Decision** |
|---|---|---|
| Example | "You should do a Zone 2 run today" | "Today's VO₂max intervals → 45 min Zone 2" |
| Structure | Emitted from nothing | **from → to**, a change to something that already exists |
| Requires | Nothing | **Knowing what you were already going to do** |

A general-purpose model can produce the left column. It cannot produce the right one,
because the right one needs your plan, your recent load, and this morning's recovery —
and then needs the arithmetic done the same way every time.

Every decision comes back in five layers:

```
Evidence → Fitness State → Decision (intent) → Action (from → to) → Reason (bound to evidence)
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

**Evidra calls no model to produce a decision.** The same evidence produces the same
decision every time, and every number is traceable. The language you read is your
assistant's; the judgment is arithmetic.

---

## Tools

| Tool | What it returns |
|---|---|
| `assess_fitness_state` | Today's recovery and training state. State only — it never says what to train. |
| `decide_session` | What today's scheduled session should become, as from → to |
| `decide_exercise_substitution` | Whether a swap is acceptable, and what to do instead when it is not |
| `generate_plan` | A plan, when you don't have one — the substrate decisions are made against |
| `preview_adjust_plan` | What adjusting a plan would change, without applying it |
| `commit_adjust_plan` | Applies a previewed adjustment and returns the resulting plan |

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

Evidra runs locally and stores nothing.

> We process only the minimum health-related evidence submitted by the caller, solely to
> compute the requested fitness decision. We do not retain, sell, use for training, or use
> it for unrelated purposes.

As a desktop extension, this is verifiable from the code that ships inside it:
**no network requests, no writes to disk, no dependencies, no telemetry, no model calls,
no accounts.** Evidence exists in memory for the duration of one tool call.

Full policy: [PRIVACY.md](PRIVACY.md)

Evidra is not a medical device and does not provide medical advice.

---

## Install

Evidra ships as a Claude Desktop extension (`.mcpb`).

1. Download the latest `evidra.mcpb` from [Releases](../../releases)
2. Open **Claude Desktop → Settings → Extensions**
3. Install the `.mcpb` file
4. Ask a question that needs a decision — for example,
   *"I've got VO₂max intervals scheduled today. Am I in shape for them?"*

**Requires Node.js 20 or newer.**

An extension is a copy taken at install time. After installing a new version, restart
Claude Desktop completely — closing the window is not enough.

### Availability

| | Status |
|---|---|
| Claude Desktop (macOS / Windows) | Supported, via the extension above |
| Mobile, and other MCP hosts | Not yet — these need a remote server, which is not open to the public yet |

---

## Support

Bug reports and questions: [open an issue](../../issues)

Privacy requests, or anything you would rather not post publicly: **evidramcp@icloud.com**

---

## License

Proprietary — see [LICENSE](LICENSE). You may install and run Evidra for your own use.
Copying, modifying, and redistributing it are not permitted.
