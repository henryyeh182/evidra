# Privacy Policy — Pacevera

**Effective date:** 2026-08-06
**Applies to:** the Pacevera Fitness desktop extension, an MCP server that runs locally on your own computer.

## Summary

Pacevera is a calculator, not a data service. It receives the health-related evidence
your AI assistant passes into a tool call, computes a training decision from it, returns
the result, and does not retain it. Running as a desktop extension, it does all of this
on your own machine.

## What Pacevera receives

Pacevera never goes and gets your data. It only ever sees what the calling AI assistant
puts into a tool call, which may include:

- Recovery signals for the current day — sleep, heart rate variability, resting heart
  rate, stress, and vendor-computed composite scores such as readiness or Body Battery
- Recent training — session type, duration, and training load
- The session you already had scheduled, and your plan, when your assistant is holding one
- Context you state yourself, such as an injury or the equipment available to you

We call these inputs *evidence*. Your assistant supplies it once per question, and only
the part a given decision needs.

## How Pacevera processes it

We process only the minimum health-related evidence submitted by the caller, solely to
compute the requested fitness decision. We do not retain, sell, use for training, or use
it for unrelated purposes.

Receiving and computing on evidence is itself processing, and we describe it as such.
What we do not do is keep it.

### Legal basis

The legal basis for processing is performance of the requested computation initiated by
the user. Pacevera processes evidence only when you ask your AI assistant a question that
requires a decision, and only for that computation.

Where the evidence you submit concerns your health, we rely on your explicit consent,
given by choosing to submit it for that computation. You can withdraw it at any time by
not submitting further evidence, or by removing the extension. Because nothing is
retained, withdrawal leaves nothing behind for us to erase.

## What Pacevera does not do

The extension ships one compiled JavaScript file, built from our source. It is minified,
so it is not pleasant reading — but the two claims below survive that: minification does
not rename the standard-library modules a file imports, so which capabilities the server
has can still be read straight off the shipped file.

- **Pacevera itself performs no outbound network requests.** Its code makes no outgoing
  HTTP, fetch, socket, or DNS calls, and it transmits your evidence nowhere. The compiled
  file imports no networking module of any kind — searching it for `node:http`,
  `node:net`, `node:dgram` or `fetch(` returns nothing. A separate HTTP transport exists
  in our source repository, kept for the possible hosted deployment described below; it
  is not compiled into the extension and does not travel in it.
- **Pacevera itself does not persist your evidence.** It writes nothing but its protocol
  responses. There is no database, no cache, no log file, and no history. The compiled
  file contains no call that writes to disk — no `writeFile`, no `appendFile`, no
  `createWriteStream`, no `mkdir` — and it opens only three kinds of file, all of which
  ship beside it and none of which are yours: the exercise catalogue, the sample data, and
  the manifest it reads its own version number out of. One function from a folder our
  repository names `packages/db` is compiled in: it turns text into a lowercase
  identifier. No database, no database client, and nothing that could write your evidence
  anywhere.
- **No third-party code.** The extension has zero runtime dependencies and runs on the
  Node.js standard library alone. No analytics, no telemetry, no crash reporting, no SDKs.
- **No model calls.** Decisions are deterministic arithmetic and explicit rules. Pacevera
  calls no AI model of its own and sends your evidence to no model provider.
- **No accounts.** Pacevera has no sign-up, no login, and no user identifier. We do not know
  who you are.

These statements describe Pacevera's own behaviour. They are not statements about the
computer it runs on, the AI assistant that calls it, or the operating system and Node.js
runtime underneath it, none of which are under our control.

Evidence exists only in memory for the duration of a single tool call.

## Data retention

Pacevera does not retain your evidence. Nothing is written to durable storage, so there is
nothing for us to keep, delete, or export on request.

Because Pacevera does not retain personal information, requests to access, correct, or
delete stored data generally do not apply. If you believe we hold something about you,
write to the address below and we will tell you what we have, which we expect to be
nothing.

Your AI assistant is a separate matter: the conversation containing your evidence and
Pacevera's results lives in that assistant's history under its own privacy policy, not ours.
If you want that removed, remove it there.

## Sharing

We have nothing to share, because we do not retain your evidence. No sale of data, no
advertising, no data brokers, no model training, and no transfer to any third party.

## Children

Pacevera is not directed at children under 13 and we knowingly collect nothing from anyone.

## Not medical advice

Pacevera computes training decisions from athletic evidence. It is intended for general
fitness and training purposes only. It is not a medical device and does not diagnose,
treat, or provide medical advice. Talk to a qualified professional about symptoms,
injuries, or medical conditions.

## Future hosted service

This policy covers the desktop extension, which runs on your machine. Should we later offer
a hosted or remote version, it will carry its own published policy describing that
deployment before you can use it. The commitment in *How Pacevera processes it* above is the
floor for any version we ship: minimum evidence, computed and discarded, never retained,
sold, or used for training.

## Changes

Material changes will be published here with a new effective date. The version history of
this document is public in this repository's commit log.

## Contact

Privacy questions and requests: **evidramcp@icloud.com**

You can also [open an issue](https://github.com/henryyeh182/evidra/issues), but note that
issues are public. Use the email address for anything you would rather not post publicly.
