# Privacy Policy — Pacevera

**Effective date:** 2026-08-17
**Applies to:** the Pacevera Fitness desktop extension, an MCP server that runs locally on the user's computer.

> **The canonical privacy policy is <https://pacevera.com/privacy>.** That is the
> address the extension's manifest points to and the one published for review.
> This file is kept for readers who arrive through the repository; where the two
> differ, the page on the site is the one that governs.

## Summary

Pacevera receives health-related Evidence supplied by the calling AI host, computes the requested fitness decision, and returns the result. No Pacevera server holds that Evidence; there is no Pacevera-operated database anywhere in this product. On the user's own computer the extension does keep two durable records — a bounded continuity record and a local store of the decisions it made, the outcomes the user reports back, and the derived state behind them. Both are described below, and both are the user's to export or delete.

## Evidence received

Pacevera does not retrieve data from health or training providers. It receives only the content that the calling AI host includes in an MCP tool call. This may include:

- Current recovery measurements, including sleep, heart-rate variability, resting heart rate, stress, and vendor-computed assessments such as readiness or Body Battery.
- Recent training sessions, including session type, duration, and training load.
- A scheduled session or caller-held training plan.
- User-provided context, including injuries, available equipment, training goals, and available time.

These inputs are referred to as Evidence. The calling host determines what Evidence to submit for each request.

## Processing purpose and legal basis

Pacevera processes the minimum health-related Evidence required to compute the requested fitness decision. It does not retain, sell, use Evidence for model training, or use Evidence for unrelated purposes.

Receiving and computing on Evidence constitutes processing. The legal basis is performance of the computation initiated by the user. Where the submitted Evidence concerns health, the user provides consent by choosing to submit it for that computation. The user may withdraw consent by discontinuing submission of Evidence or removing the extension. There is no Pacevera-side record to erase after withdrawal, because Pacevera operates no service that received it; what remains is on the user's own computer, and the deletion routes for it are described under Retention and deletion.

## Desktop extension behavior

The desktop extension is distributed as a compiled JavaScript bundle and runs locally. The following statements describe the behavior of the Pacevera process itself; they do not describe the AI host, operating system, imported files, backups, or other software on the user's computer.

- **No outbound network requests.** The desktop extension does not make HTTP, fetch, socket, or DNS requests and does not transmit Evidence to a provider or third party.
- **Two local stores, both on the user's disk.** When a caller supplies an identity, the extension uses `writeFile` and `mkdir` to maintain a bounded, hashed-identity continuity record containing the minimum state needed for continuity. Separately, it opens a local SQLite store at `~/.pacevera/pacevera.sqlite` on first start, and records there the decisions it produced, the outcomes the user submits, and the derived state behind them — readiness, fatigue and training load, rather than the raw readings a device took. Its schema also has room for profile, injury, workout and health-metric records used by the local engine. Neither store holds provider tokens, and neither is transmitted anywhere.
- **The SQLite store depends on the runtime.** `node:sqlite` exists from Node.js 22.5. On an older runtime that store cannot be opened, the extension continues without it, and nothing is written there.
- **No runtime third-party dependencies.** The extension uses the Node.js standard library and does not include analytics, telemetry, crash reporting, or external SDKs.
- **No model calls.** Decisions are produced by deterministic calculations and explicit rules. The extension does not send Evidence to an AI model provider.
- **No accounts or provider tokens.** The extension does not provide Pacevera accounts, sign-in, or provider OAuth token storage. It does not authenticate to Apple Health, Garmin, Strava, Oura, WHOOP, or another provider.

The repository also contains an HTTP transport for local or future remote deployments. That transport is separate from the desktop extension and is not covered by the desktop-specific statements above.

## Retention and deletion

Pacevera operates no service that retains Evidence. The two local stores described above are retained on the user's own computer until the user deletes them: there is no hidden expiry and no background purge. Both are exportable — the continuity record in full, the SQLite store as a readable backup — and both support deleting one identity's complete data. Removing the files has the same effect. Deleting them does not delete copies held by the AI host, the provider, the operating system, imported files, or backups; those are deleted where they live.

The AI host may retain the conversation containing the submitted Evidence and the returned decision under its own policy. The operating system, imported files, backups, and other local software may also retain copies outside Pacevera's control.

If you believe Pacevera holds personal information about you, contact us using the address below. We will review the request and respond based on the information actually held.

## Sharing

The desktop extension does not share Evidence with third parties. It does not sell Evidence, use Evidence for advertising, provide Evidence to data brokers, or use Evidence for model training.

## Children

Pacevera is not directed to children under 13. The desktop extension does not knowingly collect personal information from children.

## Medical disclaimer

Pacevera is intended for general fitness and training purposes. It is not a medical device and does not diagnose, treat, or provide medical advice. Consult a qualified professional regarding symptoms, injuries, or medical conditions.

## Future deployments

This policy applies to the local desktop extension only. A future hosted or remote deployment will require a separate published policy describing its data flows, retention, authorization infrastructure, and deletion procedures before that deployment is made available for public use.

The minimum processing commitment stated above—minimum Evidence for the requested computation, no sale, no model training, and no unrelated use—will apply to future deployments unless a more protective policy is published.

## Verifiable bundle boundary

The shipped bundle contains no provider connector credentials or outbound data path. Searching the compiled bundle for `node:http`, `node:net`, `node:dgram`, or `fetch(` must find no outbound provider call, while `writeFile` and `mkdir` may appear because they implement the bounded local continuity record described above. `node:sqlite` appears exactly once — the single place the local store is opened, on the user's own disk.

## Changes

Material changes will be published in this file with a new effective date. The public repository commit history records previous versions of this policy.

## Contact

Privacy questions and requests: **evidramcp@icloud.com**

You may also [open a GitHub issue](https://github.com/henryyeh182/evidra/issues), but issues are public. Use email for private requests.
