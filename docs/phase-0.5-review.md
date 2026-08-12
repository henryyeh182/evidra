# Pacevera Phase 0.5 Review Protocol

> Review target: public-preview UI prototype
>
> Scope: Decision Graph comprehension, Outcome feedback, and product boundary clarity
>
> This is a review instrument, not a claim that external user research has already happened.

## What we are testing

The reviewer should be able to answer three questions without reading the implementation plan:

1. What was scheduled, and what should happen today?
2. Why did Pacevera change the session?
3. What happened after the athlete acted on the decision?

The prototype uses fixture evidence for the Tempo Run → Moderate Run example. It does not require an account, connector authorization, hosted service, or durable storage.

## Five-minute reviewer script

Use the homepage at `docs/pacevera-home.html` without explaining the interface first.

### Task A — read the decision

Ask the reviewer:

> You planned a Tempo Run. What does Pacevera want you to do today, and how confident are you?

Record whether they identify:

- `Tempo Run → Moderate Run`;
- lower intensity with the same duration;
- missing sleep evidence and medium confidence.

### Task B — inspect the reason

Ask:

> What changed the decision? Open whatever you would use to check it.

Record whether they find the Decision Trace without prompting and can explain:

- `EVD-R-002` was triggered;
- the keep-as-planned candidate was suppressed;
- arbitration selected the higher-priority adjustment;
- the trace connects Rule → Evidence → Source → Version.

### Task C — report the outcome

Ask:

> Imagine you completed the adjusted session. Show how you would report what happened.

Record whether the reviewer understands `Adopted`, `Changed`, `Skipped`, and perceived effort. Confirm they notice the `prototype only` / `not saved` boundary.

## Findings form

Copy this block once per reviewer. Do not include health data or identifying information.

```text
Reviewer ID:
Date:
Role: athlete / coach / internal reviewer

Task A — decision comprehension
- Found the from → to decision without help: yes / no
- Could state what changed: yes / partly / no
- Mentioned confidence or missing signal: yes / no
- Quote or observation:

Task B — Decision Trace comprehension
- Opened trace without help: yes / no
- Identified triggered rule: yes / no
- Identified suppressed candidate: yes / no
- Understood priority/arbitration: yes / partly / no
- Understood Rule → Evidence → Source → Version: yes / partly / no
- Quote or observation:

Task C — Outcome comprehension
- Understood Adopted / Changed / Skipped: yes / partly / no
- Understood perceived effort: yes / no
- Understood prototype-only / not-saved boundary: yes / no
- Quote or observation:

Confusions or missing information:
Most useful element:
One change requested:
Keep / change / remove:
```

## Success bar for this prototype

The review pass is sufficient to move into the next UI iteration when at least 4 of 5 reviewers can, without coaching:

- state the scheduled session and the adjusted session;
- find the trace and name the governing rule;
- distinguish a suppressed rule from the governing rule;
- identify where the evidence source and version are shown;
- understand that outcome feedback is only a prototype interaction and is not saved.

Any failure involving privacy language, a false impression of connected Garmin data, or a false impression of account/durable-history capability is a release-blocking finding even if the comprehension score is high.

## Decision rules after review

- If reviewers understand the decision but not the graph, simplify graph labels before adding more nodes.
- If reviewers understand the graph but not the outcome controls, keep the controls and rewrite the labels; do not add persistence yet.
- If reviewers expect an account or connected provider, strengthen the preview boundary copy.
- Only after the review findings stabilize should Outcome persistence be designed for the local private repository in Phase 2.

## Evidence ledger

| Review artifact | Status | Notes |
|---|---|---|
| Static page and script checks | complete | Homepage contains the Tempo fixture, trace drawer, and outcome controls. |
| Repository test suite | complete | 507/507 tests passed on the merged implementation. |
| Internal reviewer sessions | pending | Fill the findings form above; do not infer this from static checks. |
| 3–5 target-user sessions | pending | Required before claiming product validation. |
| Durable outcome storage | out of scope | Phase 2 local repository, not this public preview. |
