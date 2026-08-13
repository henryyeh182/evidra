// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.
//
// GENERATED FILE — do not hand-edit. Produced by
// scripts/generate-home-scenario-fixtures.js from harness/scenarios/
// (01, 02, 03) run through the real Decision Engine chain
// (generateSemanticFitnessState + decideSession). Regenerate with:
//   npm run generate:home-scenarios

const scenarios = {
  "keep": {
    "status": "Ready to train",
    "statusClass": "",
    "metrics": [
      [
        "Readiness",
        "89"
      ],
      [
        "Sleep",
        "7h 30m"
      ],
      [
        "Leg fatigue",
        "8 / 100"
      ],
      [
        "Training load",
        "1.3h this week"
      ]
    ],
    "from": [
      "Threshold Intervals",
      "60 min · High"
    ],
    "to": [
      "Threshold Intervals",
      "60 min · High"
    ],
    "evidence": "Readiness 89 · recovery signals checked",
    "attachment": "harness/scenarios/01-a-rested-day-runs-as-planned.json",
    "prompt": "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    "handoff": "Pacevera checked the evidence and confirmed the scheduled session.",
    "reason": "<strong>Why this changed:</strong> Readiness 89 and target-muscle fatigue 8 are both within range, so the session runs as planned."
  },
  "adjust": {
    "status": "Adjust today",
    "statusClass": "adjust",
    "metrics": [
      [
        "Readiness",
        "52"
      ],
      [
        "Sleep",
        "5h 00m"
      ],
      [
        "Leg fatigue",
        "8 / 100"
      ],
      [
        "Training load",
        "1.3h this week"
      ]
    ],
    "from": [
      "Threshold Intervals",
      "60 min · High"
    ],
    "to": [
      "Moderate run",
      "60 min · Moderate"
    ],
    "evidence": "Readiness 52 · recovery signals checked",
    "attachment": "harness/scenarios/02-low-readiness-takes-a-step-off.json",
    "prompt": "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    "handoff": "Pacevera checked the evidence and returned an accountable decision.",
    "reason": "<strong>Why this changed:</strong> Readiness 52 is below 60, so intensity comes down. At moderate intensity the session is no longer \"Threshold Intervals\"; it becomes \"Moderate run\". <code>RULE EVD-R-002</code>"
  },
  "defer": {
    "status": "Recovery first",
    "statusClass": "defer",
    "metrics": [
      [
        "Readiness",
        "30"
      ],
      [
        "Sleep",
        "4h 00m"
      ],
      [
        "Leg fatigue",
        "8 / 100"
      ],
      [
        "Training load",
        "1.3h this week"
      ]
    ],
    "from": [
      "Threshold Intervals",
      "60 min · High"
    ],
    "to": [
      "Recovery + mobility",
      "30 min · Low"
    ],
    "evidence": "Readiness 30 · recovery signals checked",
    "attachment": "harness/scenarios/03-readiness-floor-defers-to-recovery.json",
    "prompt": "I have Threshold Intervals, 60 min at high intensity. Should I keep it?",
    "handoff": "Pacevera found recovery below the safety floor and replaced the session.",
    "reason": "<strong>Why this changed:</strong> Readiness 30 is below 40: no training load today, swapped to a recovery session of at most 30 minutes. <code>RULE EVD-R-001</code>"
  }
};
