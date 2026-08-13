// GENERATED FILE — run npm run generate:home-live to refresh.
globalThis.PACEVERA_TODAY_BRIEF = {
  "userId": "user",
  "date": "2026-07-22",
  "evidence": {
    "stateId": "state_8218d686cae1b2b3fc83fe3d",
    "window": {
      "asOf": "2026-07-22",
      "earliest": "2026-07-20T11:40:00Z",
      "latest": "2026-07-22T23:59:59"
    },
    "coverage": {
      "recovery": {
        "usable": [
          "sleep",
          "hrv",
          "restingHeartRate",
          "stress",
          "vendorReadiness",
          "bodyBattery",
          "recoveryTime"
        ],
        "missing": []
      },
      "training": {
        "usable": [],
        "missing": [
          "trainingLoad"
        ]
      }
    },
    "sources": [
      "apple_health",
      "garmin",
      "google_health_api",
      "strava"
    ]
  },
  "state": {
    "readinessScore": 54,
    "recoveryScore": 76,
    "fatigueScore": 46
  },
  "decision": {
    "type": "adjust",
    "intent": "reduce_today_intensity"
  },
  "action": {
    "from": {
      "focus": "Threshold Intervals",
      "type": "run",
      "durationMinutes": 60,
      "intensity": "high",
      "exerciseIds": [],
      "exercises": []
    },
    "to": {
      "focus": "Moderate run",
      "type": "run",
      "durationMinutes": 60,
      "intensity": "moderate",
      "exerciseIds": [],
      "exercises": []
    },
    "changed": [
      "focus",
      "intensity"
    ]
  },
  "reason": [
    "Readiness 54 is below 60, so intensity comes down.",
    "At moderate intensity the session is no longer \"Threshold Intervals\"; it becomes \"Moderate run\"."
  ],
  "confidence": "medium",
  "trace": {
    "engineVersion": "1.6.0",
    "libraryVersion": "1.5.0",
    "releaseVersion": "0.5.0",
    "governingRule": {
      "ruleId": "EVD-R-002",
      "title": "Low readiness pulls intensity down one step",
      "measured": {
        "quantity": "readiness_score",
        "value": 54
      },
      "thresholds": [
        {
          "key": "readinessReduce",
          "operator": "<",
          "value": 60,
          "unit": "readiness_score"
        }
      ]
    },
    "appliedRules": [
      {
        "ruleId": "EVD-R-002",
        "applied": true
      }
    ]
  }
};
