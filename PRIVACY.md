# Privacy Policy — Pacevera

**Effective date:** 2026-08-11
**Applies to:** the Pacevera Fitness desktop extension, an MCP server that runs locally on the user's computer.

> **The canonical privacy policy is <https://pacevera.com/privacy>.** That is the
> address the extension's manifest points to and the one published for review.
> This file is kept for readers who arrive through the repository; where the two
> differ, the page on the site is the one that governs.

## Summary

Pacevera receives health-related Evidence supplied by the calling AI host, computes the requested fitness decision, returns the result, and performs bounded local continuity when the caller supplies an identity. Raw Evidence is not retained as a health-history database.

## Evidence received

Pacevera does not retrieve data from health or training providers. It receives only the content that the calling AI host includes in an MCP tool call. This may include:

- Current recovery measurements, including sleep, heart-rate variability, resting heart rate, stress, and vendor-computed assessments such as readiness or Body Battery.
- Recent training sessions, including session type, duration, and training load.
- A scheduled session or caller-held training plan.
- User-provided context, including injuries, available equipment, training goals, and available time.

These inputs are referred to as Evidence. The calling host determines what Evidence to submit for each request.

## Processing purpose and legal basis

Pacevera processes the minimum health-related Evidence required to compute the requested fitness decision. It does not retain, sell, use Evidence for model training, or use Evidence for unrelated purposes.

Receiving and computing on Evidence constitutes processing. The legal basis is performance of the computation initiated by the user. Where the submitted Evidence concerns health, the user provides consent by choosing to submit it for that computation. The user may withdraw consent by discontinuing submission of Evidence or removing the extension. Because the extension does not retain Evidence, there is no Pacevera-side record to erase after withdrawal.

## Desktop extension behavior

The desktop extension is distributed as a compiled JavaScript bundle and runs locally. The following statements describe the behavior of the Pacevera process itself; they do not describe the AI host, operating system, imported files, backups, or other software on the user's computer.

- **No outbound network requests.** The desktop extension does not make HTTP, fetch, socket, or DNS requests and does not transmit Evidence to a provider or third party.
- **Bounded continuity only.** When a caller supplies an identity, the local extension may use `writeFile` and `mkdir` to maintain a bounded, local, hashed-identity continuity record containing the minimum state needed for continuity. It does not write raw provider payloads, provider tokens, or an unbounded health history.
- **No runtime third-party dependencies.** The extension uses the Node.js standard library and does not include analytics, telemetry, crash reporting, or external SDKs.
- **No model calls.** Decisions are produced by deterministic calculations and explicit rules. The extension does not send Evidence to an AI model provider.
- **No accounts or provider tokens.** The extension does not provide Pacevera accounts, sign-in, or provider OAuth token storage. It does not authenticate to Apple Health, Garmin, Strava, Oura, WHOOP, or another provider.

The repository also contains an HTTP transport for local or future remote deployments. That transport is separate from the desktop extension and is not covered by the desktop-specific statements above.

## Retention and deletion

Pacevera does not retain raw Evidence as a durable health-history database. The local continuity record is process-local to the configured environment, bounded, exportable, and deletable through the continuity tools. Deleting the record removes the Pacevera-side continuity state; it does not delete copies held by the AI host, operating system, imported files, or backups.

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

The shipped bundle contains no provider connector credentials or outbound data path. Searching the compiled bundle for `node:http`, `node:net`, `node:dgram`, or `fetch(` must find no outbound provider call, while `writeFile` and `mkdir` may appear because they implement the bounded local continuity record described above.

## Changes

Material changes will be published in this file with a new effective date. The public repository commit history records previous versions of this policy.

## Contact

Privacy questions and requests: **evidramcp@icloud.com**

You may also [open a GitHub issue](https://github.com/henryyeh182/evidra/issues), but issues are public. Use email for private requests.
