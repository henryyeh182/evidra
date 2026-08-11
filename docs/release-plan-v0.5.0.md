# Pacevera v0.5.0 release plan

Status: planned, not released  
Baseline: public MCPB v0.4.2  
Prepared: 2026-08-11

## Fixed runtime identity

| Version line | Next release | Why |
|---|---:|---|
| Product / MCPB | `0.5.0` | The public tool surface and product capabilities grow; this is a backward-compatible feature release, not a patch. |
| Decision Engine | `1.6.0` | No condition evaluation, arbitration or effect-combination behavior changed after v0.4.2. |
| `base_rules` package | `1.1.0` | Adds the package lifecycle, evidence packets, validation, dry-run, explicit install and rollback around the base rule set. |

The user-facing release identity is fixed as:

> Pacevera v0.5.0，使用 Decision Engine v1.6.0 與 base_rules v1.1.0。

Rule Library `1.5.0` remains in the legacy `decisionBasis.libraryVersion` field
for compatibility, but it is not an independent release line from v0.5.0 onward.

Do not bump `package.json`, `manifest.json` or `server.json` to 0.5.0 until the
release blockers below are closed and the artifact is ready to pack. The
planned combination is already recorded in `docs/release-version-lines.json`;
`npm run review:release` will verify it against the actual bundle after the
product version is bumped.

## Feature ownership

| Change since v0.4.2 | Owner / version line | Version effect |
|---|---|---|
| Personalized single-session `generate_workout` tool (`62862fc`) | Product / MCPB | Product `0.4.2 → 0.5.0`; adds a new public decision surface with picker duration/focus, schemas and tests. It must be integrated into `main` before packaging. |
| `get_evidence_coverage`, `explain_decision`, `submit_outcome` become public tools | Product / MCPB | Product `0.4.2 → 0.5.0`; the tool surface is an observable new capability. |
| `decisionId`, bounded decision trace and outcome-event registry | Product / MCPB | Included in Product `0.5.0`; no Engine bump because rule evaluation and verdicts do not change. |
| Cross-conversation athlete continuity and local state store | Product / MCPB and privacy contract | Included in Product `0.5.0` only after the public privacy policy describes persistence, deletion and retention accurately. |
| Plan Decision Harness for generate/preview/commit, substitution harness, package regression gate and release-install smoke | QA / release governance | No independent runtime version bump. They are mandatory release evidence for 0.5.0. |
| Candidate-package checksum/schema/compatibility validation followed by Decision Harness and regression comparison before pointer activation | `base_rules` package lifecycle | `base_rules@1.1.0`. This is the package-injection boundary: an invalid or behavior-drifting candidate cannot become active. It is not a Decision Engine semantic change. |
| Five formal evidence packets and corrected/regraded HRV, ACWR and detraining references | `base_rules` content | Package `1.0.0 → 1.1.0`; Engine stays `1.6.0`. The legacy Library field moves to 1.5.0 but is no longer independently released. |
| Decision Graph viewer | Local review tooling | No Product, Library or Engine bump by itself; ship only if intentionally included as a developer asset. |
| OAuth/authorization, REST contract and remote/private-engine foundations | Source architecture, not current hosted product availability | Do not market as a hosted feature. They can accompany the source release, but hosted availability remains no-go until its separate readiness gates pass. |

## “Generate workout” integration state

Commit `62862fc` completes the canonical `generate_workout` tool as a
single-session counterpart to `generate_plan`: duration and focus pickers feed a
session template through the existing `decide_session` path, producing a
personalized `from → to` workout with `decisionBasis`, evidence coverage and
provenance. It includes the tool definition, handler, input/output schemas and
tool tests.

The commit exists in the repository object database but no local or remote
branch currently contains it; it is not an ancestor of `main`. Its parent
`6992c32` (`Add prompt injection guards to decision harness`) is on the same
unmerged line. Both must be integrated and rerun through the release gates
before v0.5.0 is packed.

`single_workout_rules@0.1.0` in that commit is explicitly `draft`. EVD-R-013–015
are not loaded by the workout runtime; the completed tool currently reuses
Decision Engine 1.6.0 and active `base_rules@1.1.0`. Therefore the fixed runtime
identity remains unchanged. Activating the domain package is a later package
release, not something v0.5.0 may imply has already happened.

## Release blockers

1. Integrate `6992c32` and `62862fc` into `main`, preserving the fixed runtime
   identity metadata and rerunning the single-workout and prompt-injection tests.
2. Update the public `evidra/PRIVACY.md` before shipping athlete continuity;
   v0.4.2 currently promises no Evidence persistence.
3. Reconcile the public README, manifest tool list and MCPB `tools/list` with
   the ten advertised public tools after `generate_workout` is integrated.
4. Resolve the current `review:phase` G1 drift: the documented test count is
   stale and the athlete-continuity test has an unexpected failure.
5. Run the full tests, Decision Harness, Plan Harness, substitution harness,
   regression gate, package dry-run, release-install smoke and phase review.
6. Bump Product files to 0.5.0, pack the MCPB, then run
   `npm run review:release` in local mode before publishing and again in
   published mode afterward.
