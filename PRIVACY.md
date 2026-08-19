# Pacevera Privacy Policy

This file is the GitHub public mirror of the canonical policy:

`docs/privacy-policy.md` in the Pacevera source repository

Canonical URL: https://pacevera.com/privacy  
Version: 0.5.3-P0-3  
Effective date: 2026-08-18  

The mirror must remain byte-for-byte synchronized with `docs/privacy-policy.md` in the source repository. Run:

```text
npm run check:public-policy-sync
```

The canonical policy is reproduced below.

---

# Pacevera Privacy Policy

**Version:** 0.5.3-P0-3  
**Effective date:** 2026-08-18  
**Canonical URL:** https://pacevera.com/privacy  
**GitHub mirror:** https://github.com/henryyeh182/evidra/blob/main/PRIVACY.md

This policy describes the Pacevera public preview and the planned local and remote deployment boundaries. B and C are not available public services until their release gates are complete.

## Who is responsible

For the current public preview, the controller/operator is **Henry Yeh, an individual operator based in Taiwan**, operating under the Pacevera name. Pacevera is not a separate incorporated legal entity. For privacy questions or requests, contact **evidramcp@icloud.com**. A registered service address and any successor legal entity will be published before a paid or production launch.

For the local desktop preview, Pacevera operates no server that receives your health data. You control the computer, files, backups, AI host, and operating-system services that may hold copies. For a future remote service, the controller/processor allocation, subprocessors, transfer safeguards, and DPA will be published before launch.

## What Pacevera does

Pacevera is a fitness decision-support engine. It normalizes activity and recovery evidence, computes derived fitness state, applies deterministic rules, and returns a decision such as keep, adjust, substitute, or defer. It is not a medical device and does not diagnose, treat, prevent, or clear a medical condition.

## Deployment modes

### Local desktop preview — v0.5.2, available now

The AI host sends a tool request over stdio. The bundle processes the supplied Evidence locally and does not fetch Apple Health, Google Health, Garmin, Strava, or other provider data. It does not send health Evidence to a Pacevera server or call an AI model of its own.

The local process may write:

- a hashed-identity continuity record under the configured local state directory; and
- a SQLite store at `~/.pacevera/pacevera.sqlite` (or `PACEVERA_DB_PATH`) containing derived state, decision traces, outcomes, and schema capacity for user context and health-related records.

The local SQLite store is opened through `node:sqlite` and is durable user-controlled state.
Its current schema discloses these tables explicitly: `users`, `goals`, `preferences`,
`injuries`, `equipment`, `workouts`, `health_metrics`, `semantic_fitness_states`, `plans`,
`planned_workouts`, `decision_records`, and `outcome_records`. These tables contain user
context, constraints, planned and completed workouts, health-related metrics, derived
fitness state, decision traces, and reported outcomes as applicable; they do not turn the
hosted service into a health-data store. The user controls export and deletion of these
local records, including operating-system backups and other copies outside Pacevera.

Three further tables are defined in the repository's migrations but are **not created by
any shipped release**: `connector_accounts` (connector authorization state and scope),
`raw_provider_events` (raw provider payloads), and `normalized_events` (normalized
events). The shipped desktop engine creates only the twelve tables listed above. These
three are disclosed here in advance so that the release which first creates them cannot
do so silently; until then, no Pacevera release writes a raw provider payload to disk.

These records remain on the user-controlled device until the owner exports or deletes them. Host conversations, imported files, operating-system backups, and copies held by the AI host or providers are outside Pacevera's control and must be deleted where they live.

### B — local Google Health connector — planned for v0.5.3

The user authorizes Google in their own browser. The local connector calls only the approved Google Health endpoints, normalizes the response into Evidence, and keeps the provider grant, encrypted token vault, fetched data, and local derived records on the user's device. The planned QR-assisted path may use an authorization-only relay for the phone handoff; that relay will handle only a short-lived transaction, OAuth state, and authorization code until the local client claims it, and will not receive Evidence, raw Google Health responses, health fields, tokens, or the PKCE verifier. The QR path is not available until its separate deployment, privacy, and end-to-end gates pass.

The connector will request only read scopes required for activity/fitness, sleep, resting heart rate, and HRV. Access and refresh tokens will not be returned to the AI host or written to logs. Disconnect, provider revoke, unlink, local deletion, export, and failed-sync behavior must be verified before B ships.

### C — user-controlled mobile path — planned

The planned mobile path reaches a Pacevera engine running on the user's own machine through a reviewed pairing and transport channel. The plan, continuity, outcomes, provider credentials, and Evidence remain in that user-controlled environment; the machine must be running. Pacevera does not connect directly to Apple Health, Google Health, Garmin, or Strava in this path and must not receive provider refresh tokens.

The statement that the operator receives nothing is conditional on the selected channel preserving end-to-end confidentiality. If a tunnel, relay, reverse proxy, or other third party terminates TLS and can read Evidence, that party is a recipient and its controller/processor role, retention, access, transfers, and deletion must be disclosed and reviewed. Mobile AI-host compatibility and the exact TLS termination point remain unverified. A Pacevera-operated hosted remote service remains no-go; if introduced later, it requires a separate retention, logging, subprocessor, transfer, and deletion release gate.

If `hosted-remote` is later activated, this policy will be amended before launch to identify the authorization server, client-registration records, identifiers and any per-MAU activity records, subprocessors, international transfers, and retention/deletion periods for Evidence, logs, traces, queues, backups, and authorization records. That activation also requires a hosted DPIA and an independent remote-image/outbound release gate; the current no-go status must not be read as an available hosted service.

### User-controlled private / Enterprise deployment — future

The user or organization controls the device, private network, NAS, or VPC. That operator controls retention, access, backups, deletion, provider credentials, DPA obligations, and data-subject request handling. A separate deployment policy and DPA are required.

## Data categories, purposes, and recipients

Depending on the deployment mode and the user's request, data may include:

- activity and workout history, training load, sleep, HRV, resting heart rate, stress, and vendor assessments;
- goals, planned workouts, injuries, constraints, and the user's natural-language question;
- normalized Evidence, provenance, freshness, coverage, semantic fitness state, confidence, decision, rule basis, and reported outcome;
- local OAuth credentials for B, stored only in the user-controlled credential boundary; and
- operational metadata needed to provide or secure a remote service, if C is ever launched.

Pacevera uses this information only to provide, secure, test, and improve the requested fitness decision service. It does not sell health data, use it for advertising, or use provider health data to train an AI model.

Recipients depend on the mode: the user's AI host and operating system in local mode; the authorized Google endpoint in B; and the user's AI host, authorized infrastructure providers, and documented subprocessors in C. Provider copies remain governed by the provider's own policy.

## AI host and provider boundaries

Claude, ChatGPT, and other AI hosts may select data, retain conversations, create prompts, and apply their own account, model, training, and deletion policies. Pacevera does not control those copies. Review the AI host's policy before sending health data.

Pacevera is not affiliated with, sponsored by, or a representative of Strava, Google, Apple, Garmin, Claude, ChatGPT, or any other provider. The Strava official MCP is a provider/host path; Pacevera does not copy the Strava connector or store Strava tokens.

## Retention, export, deletion, and withdrawal

Local records are retained until the user deletes them, unless a shorter product-specific period is stated. The user can export or delete owner-scoped local records and remove local files. Provider authorization must also be revoked at the provider; deleting a local token does not delete a provider's copy, and provider revocation does not automatically delete local files or AI-host conversations.

For a future remote service, the published policy will identify each application, log, trace, queue, backup, authorization-server, and subprocessor retention period and deletion route. No remote service is currently authorized to claim that this has been completed.

## Rights and requests

Where GDPR applies, users may have rights of access, rectification, erasure, restriction, portability, and objection, subject to applicable exceptions. Send requests to **support@pacevera.com** with enough information to identify the relevant deployment, without sending health data unnecessarily. Requests concerning an AI host, provider, operating-system backup, or user-controlled private deployment must be directed to that operator as well.

## Changes

The canonical policy is maintained in the Pacevera source repository at `docs/privacy-policy.md`. `PRIVACY.md` is a synchronized GitHub mirror, and `docs/privacy.html` is the website rendering. The version and effective date must be updated together; the policy-sync check must pass before release.
