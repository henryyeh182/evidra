# Pacevera Fitness Decision Engine

Pacevera is a deterministic fitness decision engine exposed through the Model Context Protocol (MCP). It receives normalized training and health evidence supplied by the calling AI host, evaluates recovery and training constraints, and returns a structured decision.

The primary operation is to evaluate an existing scheduled session. A decision describes the change from the scheduled session to the resulting session:

```text
scheduled session (from) -> resulting session (to)
```

Each decision includes the relevant evidence, applied rules, confidence, signal coverage, and limitations.

## Scope

Pacevera provides the following capabilities:

- Deterministic calculation of recovery state, readiness, muscle-group fatigue, and training load.
- Session decisions with the types `keep`, `adjust`, `substitute`, `defer`, and `advance`.
- Constraint handling for injuries, equipment, available time, and exercise substitutions.
- Training-plan generation and caller-owned plan adjustment through preview and commit operations.
- Structured decision provenance through rule identifiers, measured values, source information, and version metadata.
- Normalization support for Apple Health, Google Health Takeout, Garmin, Strava, Oura, and WHOOP data shapes.

Pacevera does not connect to these providers on behalf of the user. The calling host must obtain and normalize provider exports or API responses before passing them to an MCP tool.

## Architecture

```text
AI host
  └─ Collects the user's question and evidence
       └─ MCP server / desktop extension
            ├─ Evidence normalization
            ├─ Fitness-state calculation
            ├─ Training-load calculation
            ├─ Deterministic rule evaluation
            ├─ Decision and plan operations
            └─ Structured result: Decision / Action / Reason
```

The AI host is responsible for interpreting the user's request, collecting evidence, selecting tools, and presenting the result. Pacevera performs the calculations and rule evaluation; it does not call a model to generate a decision. Given the same code, rule set, and input, the result is deterministic.

## Decision and recommendation

| Type | Description |
|---|---|
| Recommendation | A training suggestion generated without a required prior session or plan. |
| Decision | A traceable change applied to an existing scheduled session or plan. |

`decide_session` requires `scheduledSession` to establish the prior state. If no scheduled session is provided, the tool returns `no_scheduled_session` rather than creating a session. Use `generate_plan` when a plan is required.

Decision output follows five layers:

```text
Evidence -> Fitness State -> Decision -> Action -> Reason
```

Decision intent and resulting action are separate fields. The same intent may produce different actions depending on the user's equipment, available time, injuries, and scheduled session.

## MCP tools

### Decision and planning tools

| Tool | Description |
|---|---|
| `assess_fitness_state` | Returns recovery, readiness, muscle-group fatigue, and training-load state. |
| `decide_session` | Evaluates a scheduled session and returns the resulting session. |
| `decide_exercise_substitution` | Selects a replacement movement subject to injury and equipment constraints. |
| `generate_plan` | Generates a periodized training plan. |
| `preview_adjust_plan` | Returns a deterministic patch and diff for a caller-owned plan. |
| `commit_adjust_plan` | Validates the plan version and applies a caller-owned patch. |

### Supporting and read tools

| Tool | Description |
|---|---|
| `get_evidence_coverage` | Reports available and missing evidence signals. |
| `explain_decision` | Returns the process-local rule and source trace for a previous decision. |
| `submit_outcome` | Accepts an observed outcome for a prior case; storage is bounded and local to the configured environment. |
| `search_exercises` / `get_exercise` | Queries the exercise catalog and graph relationships. |
| `search_workouts` / `get_workout` | Queries structured workout content. |
| `get_user_profile` | Returns caller-supplied user constraints and training settings. |
| `get_training_history` / `get_training_context` | Returns training history and related context. |

## Evidence and output

Evidence is supplied by the calling host. It may include recovery measurements, vendor-computed assessments, completed workouts, scheduled sessions, goals, and constraints.

Important input rules:

- Only measured or explicitly provided values should be sent. Missing signals are reported in `signalCoverage` and may lower `confidence`.
- A workout without a training-load value is not treated as zero load and is excluded from muscle-group fatigue calculations.
- RPE may be retained as evidence but is not a term in training-load or muscle-fatigue calculations.
- Vendor-computed values such as readiness, recovery, and Body Battery are used as reported and are not recomputed by Pacevera.

A typical `decide_session` response has this shape:

```json
{
  "decision": { "type": "adjust", "intent": "reduce_today_intensity" },
  "action": {
    "from": { "focus": "Tempo Run", "durationMinutes": 50, "intensity": "high" },
    "to": { "focus": "Moderate run", "durationMinutes": 50, "intensity": "moderate" },
    "changed": ["focus", "intensity"]
  },
  "confidence": "high",
  "signalCoverage": {
    "recovery": { "usable": ["readiness"], "missing": ["sleep"] },
    "training": { "usable": ["trainingLoad"], "missing": [] }
  },
  "decisionBasis": {
    "governingRule": {
      "ruleId": "EVD-R-002",
      "measured": { "quantity": "readiness_score", "value": 48 }
    }
  }
}
```

Pacevera does not fill missing values with defaults. `signalCoverage.recovery` describes current recovery-signal availability; `signalCoverage.training` describes whether recent workouts include the training-load data required for fatigue calculations.

## Deployment status

| Deployment mode | Status | Boundary |
|---|---|---|
| Local desktop extension | Available | Runs through stdio on the user's computer. The Pacevera process does not fetch provider data, persist Evidence, or make model calls. |
| User-controlled private deployment | Planned | Intended to run in a device, private network, or VPC controlled by the user or organization. |
| Hosted remote deployment | Not available | The repository contains resource-server readiness code, but production deployment, authorization infrastructure, and hosted privacy controls are not complete. |

The desktop extension has no runtime dependencies beyond the Node.js standard library. It does not use analytics, telemetry, crash reporting, provider accounts, or provider OAuth tokens.

## Privacy

The desktop extension processes the minimum health-related Evidence supplied by the caller for the requested fitness decision. It does not retain, sell, use for model training, or use Evidence for unrelated purposes.

The extension makes no outbound network requests and sends Evidence nowhere. On the user's own computer it does keep durable records: a bounded continuity record, and a local SQLite store holding the decisions it produced, the outcomes the user reports back, and the derived state behind them. Both are the user's to export or delete. The AI host, operating system, imported files, and any host conversation history are outside the extension's control and are governed by their respective policies.

See [PRIVACY.md](PRIVACY.md) for the complete policy and deployment scope, and [TERMS.md](TERMS.md) for the terms of use. The canonical versions are published at <https://pacevera.com/privacy> and <https://pacevera.com/terms>.

Pacevera is not a medical device and does not provide medical advice. It is intended for general fitness and training purposes only.

## Installation

Pacevera is distributed as a Claude Desktop extension (`.mcpb`).

1. Download `pacevera.mcpb` from [Releases](../../releases).
2. Optionally verify the SHA-256 checksum published in the release notes:

   ```bash
   shasum -a 256 pacevera.mcpb
   ```

3. In Claude Desktop, open **Settings -> Extensions** and install the file.
4. Restart Claude Desktop after installing or upgrading the extension.

The extension requires Node.js 20 or newer. Local persistence of decision traces and outcomes needs Node.js 22.5 or newer, which is where `node:sqlite` exists; on Node 20 or 21 the extension installs and runs without it, and reading your selected export folder for a decision is unaffected. The local plan decision is offered only once this machine holds a plan and its context, so a fresh installation does not list it — that depends on what is stored, not on the Node version.

Claude Desktop and other local MCP hosts are supported through the desktop extension. Mobile and hosted remote use cases require a remote deployment, which is not currently available for public use.

## Release status

The current public release is `v0.5.6`, using Decision Engine `1.9.0` and `base_rules@1.4.0`. It includes ten public tools, bounded local continuity, personalized single-workout generation, decision traces, package validation／dry-run／rollback, and an optional local Google Health connection. The Oura and WHOOP readers were implemented from their published API specifications and have not yet been validated against real responses; Apple Health, Garmin, Google Health, and Strava readers were developed from real export files.

## Support

- Bug reports and technical questions: [GitHub Issues](../../issues)
- Privacy requests: **support@pacevera.com**

## License

Pacevera is proprietary software. See [LICENSE](LICENSE) for the applicable terms.

## Pacevera v0.5.6

The Claude Desktop extension includes Today’s Brief, evidence-first local export reading, and plain-language tool titles. During installation, choose **Your exported health data folder** and select the parent folder containing any of these optional subfolders:

```text
Your exported health data folder/
├── export_apple_health/        # Apple Health export.xml
├── export_garmin/              # Garmin Export Your Data / DI_CONNECT
├── export_strava/              # Strava activities.csv
└── export_google_health/       # raw/ for JSON you pulled yourself,
                                # normalized/ for what the connection wrote
```

Pacevera reads the selected folder locally; missing sources are reported as unavailable rather than guessed. The MCPB checksum is published in the release notes.

v0.5.6 includes an optional Google Health connection that runs on your computer. You
approve it in your own browser, or by scanning a QR code with a phone; the
browser route reaches Google with no Pacevera server anywhere in its path, and
the QR route passes through a Pacevera relay that handles only a short-lived
authorization handoff — never your health data, your tokens, or the PKCE secret
that completes the exchange on your machine. Whichever route you finish cancels
the other.

In v0.5.6 the connection normalizes each Google Health response in memory and
writes only the resulting evidence; the provider response itself is never
written to disk. You can also disconnect from inside the app: it revokes the
grant at Google, deletes the stored credential, deletes the evidence earlier
syncs wrote, and clears the derived records from the local store. Files you
placed in the folder yourself are reported back for you to delete, never
removed for you.

**This connection is capped at 100 accounts, and Google will warn you that it
has not verified the app.** Pacevera's Google app moved out of `Testing` into
`Production` on 2026-08-20, so an invitation is no longer required — but
Google's verification review for the health scopes is not complete. Until it is,
Google shows its own "Google hasn't verified this app" screen before you can
consent, and at most 100 accounts can authorize the connection, counted over the
app's entire lifetime. Reading your own exported folders, supplying evidence
through your AI host, and every decision tool are unaffected.

v0.5.6 reads your HRV against your own recent nights rather than a fixed reference, and where your device already computed a readiness or HRV score, that score is used instead of scoring the raw reading a second time. The raw reading is kept and reported as superseded, named alongside what replaced it, so a decision can no longer say a reading is missing when you supplied one. Connecting Google Health, syncing it, and asking for today's decision from a stored plan no longer ask you for an account identifier: Pacevera never issued one, and being asked for it again in a later conversation is what made a working connection look expired. Where this machine holds more than one profile, Pacevera asks which one by name rather than guessing.

v0.5.2 added the source chain to every reading — where Pacevera read it, and which app wrote it, so a Garmin figure synced into Apple Health is not reported as Apple Health's own. A reading whose writer the export does not name is reported as unnamed rather than guessed. Decisions also carry a small continuity record that a later conversation can hand back; Pacevera checks whether it still describes your current state and says so when it does not. It is checked, never merged: the decision always comes from the evidence held now.
