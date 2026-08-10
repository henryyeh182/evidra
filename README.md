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
| `submit_outcome` | Accepts an observed outcome for a prior case; durable storage remains the caller's responsibility. |
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

The extension does not make outbound network requests or persist Evidence. The AI host, operating system, imported files, and any host conversation history are outside the extension's control and are governed by their respective policies.

See [PRIVACY.md](PRIVACY.md) for the complete policy and deployment scope.

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

The extension requires Node.js 20 or newer.

Claude Desktop and other local MCP hosts are supported through the desktop extension. Mobile and hosted remote use cases require a remote deployment, which is not currently available for public use.

## Release status

The current public release is `v0.4.2`. The deterministic decision engine and evaluation suite are implemented, but the engine has not been validated across extended real-world training blocks. The Oura and WHOOP readers were implemented from their published API specifications and have not yet been validated against real responses; Apple Health, Garmin, Google Health, and Strava readers were developed from real export files.

## Support

- Bug reports and technical questions: [GitHub Issues](../../issues)
- Privacy requests: **evidramcp@icloud.com**

## License

Pacevera is proprietary software. See [LICENSE](LICENSE) for the applicable terms.
