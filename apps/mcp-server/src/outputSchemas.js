// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * What each decision comes back as, declared to the client.
 *
 * A host that knows the shape can read `structuredContent` straight through
 * instead of parsing prose out of a text block, and a caller can tell which
 * fields it is allowed to rely on. Kept beside the input schemas rather than
 * loaded from `schemas/tools/` at runtime: those files are development surface
 * and stay out of the packed bundle, so a server that read them would work in
 * the repo and fail in the extension. The copies are held identical by
 * eval/test/contract.test.js, the same way the input schemas already are.
 *
 * `$schema`, `$id` and `title` are dropped on purpose — they describe the file,
 * not the payload.
 */
export const outputSchemas = {
  evidra_assess_fitness_state: {
    "type": "object",
    "properties": {
      "userId": {
        "type": "string"
      },
      "date": {
        "type": "string"
      },
      "timezone": {
        "type": "string"
      },
      "recoveryScore": {
        "type": "number"
      },
      "readinessScore": {
        "type": "number"
      },
      "fatigueScore": {
        "type": "number"
      },
      "sleepQuality": {
        "type": [
          "number",
          "null"
        ]
      },
      "trainingLoad7d": {
        "type": "number"
      },
      "trainingLoad28d": {
        "type": "number"
      },
      "acuteChronicWorkloadRatio": {
        "type": "number"
      },
      "muscleFatigue": {
        "type": "object",
        "additionalProperties": {
          "type": "number"
        }
      },
      "recommendedFocus": {
        "type": "string"
      },
      "avoid": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "availableTimeMinutes": {
        "type": [
          "number",
          "null"
        ],
        "description": "Minutes the user stated they have. null when they never said — never guessed, so downstream reasons can cite it."
      },
      "goalAlignment": {
        "type": "object",
        "properties": {
          "primaryGoal": {
            "type": "string"
          },
          "score": {
            "type": "number"
          }
        },
        "required": [
          "primaryGoal",
          "score"
        ]
      },
      "confidence": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high"
        ]
      },
      "signalCoverage": {
        "type": "object",
        "description": "Signal coverage in two groups. `recovery` covers the freshness of sleep/HRV/resting-HR/stress and vendor composites; `training` covers whether every session in the last 7 days carried a training load. A gap in either lowers confidence, and they are kept apart so a caller can tell which half is unread. The load is the vendor's own effort figure and is used as it stands — RPE is carried as evidence but is not a term in any sum, so a source that never reports one is not penalised.",
        "properties": {
          "recovery": {
            "type": "object",
            "properties": {
              "usable": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "missing": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "usable",
              "missing"
            ]
          },
          "training": {
            "type": "object",
            "properties": {
              "usable": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "missing": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "usable",
              "missing"
            ]
          }
        },
        "required": [
          "recovery",
          "training"
        ]
      },
      "reasoning": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "provenance": {
        "type": "object",
        "properties": {
          "evidenceSource": {
            "type": "string",
            "enum": [
              "provided",
              "demo_seed",
              "server_durable_record"
            ]
          },
          "signalWriters": {
            "type": "object",
            "description": "Where each signal came from and who wrote it, and when it was last written. Keyed by canonical signal name. A signal being listed does not make it current: compare its `latest` against the others to see a device that stopped writing.",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "sources": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "What the caller said this signal came from, sorted — the `source` field on each reading. Empty when no reading of this signal stated one."
                },
                "writers": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Devices or apps that wrote this signal, sorted. Empty when the connector recorded none."
                },
                "latest": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "ISO 8601 of the most recent reading of this signal."
                },
                "baselineEstablishing": {
                  "type": "boolean",
                  "description": "True when the vendor says its own baseline for this signal is still forming — Garmin marks a daily HRV reading ONBOARDING until it has enough nights to compare against. The reading is used at full value and no penalty is applied to it; say so if the user asks how far to trust it. Absent means no vendor flagged it, not that the baseline is established."
                }
              }
            }
          }
        },
        "required": [
          "evidenceSource"
        ]
      }
    },
    "required": [
      "userId",
      "date",
      "timezone",
      "recoveryScore",
      "readinessScore",
      "fatigueScore",
      "muscleFatigue",
      "recommendedFocus",
      "avoid",
      "availableTimeMinutes",
      "goalAlignment",
      "confidence",
      "reasoning"
    ]
  },

  evidra_decide_session: {
    "type": "object",
    "properties": {
      "decisionId": { "type": "string" },
      "userId": {
        "type": "string"
      },
      "date": {
        "type": "string"
      },
      "planId": {
        "type": [
          "string",
          "null"
        ]
      },
      "evidence": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "signal": {
              "type": "string"
            }
          },
          "required": [
            "signal"
          ]
        }
      },
      "state": {
        "type": "object"
      },
      "decision": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "keep",
              "adjust",
              "substitute",
              "defer",
              "advance"
            ]
          },
          "intent": {
            "type": "string"
          }
        },
        "required": [
          "type",
          "intent"
        ]
      },
      "action": {
        "type": "object",
        "properties": {
          "from": {
            "type": "object",
            "properties": {
              "sessionId": {
                "type": "string"
              },
              "focus": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "durationMinutes": {
                "type": "number"
              },
              "intensity": {
                "type": "string"
              },
              "exerciseIds": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Canonical exercise ids — the form decisions reference."
              },
              "exercises": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "The same movements spoken for a human; derived from exerciseIds."
              }
            },
            "required": [
              "focus",
              "type",
              "durationMinutes",
              "intensity",
              "exercises"
            ],
            "nullable": true
          },
          "to": {
            "type": "object",
            "properties": {
              "sessionId": {
                "type": "string"
              },
              "focus": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "durationMinutes": {
                "type": "number"
              },
              "intensity": {
                "type": "string"
              },
              "exerciseIds": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Canonical exercise ids — the form decisions reference."
              },
              "exercises": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "The same movements spoken for a human; derived from exerciseIds."
              }
            },
            "required": [
              "focus",
              "type",
              "durationMinutes",
              "intensity",
              "exercises"
            ],
            "nullable": true
          },
          "changed": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "from",
          "to",
          "changed"
        ]
      },
      "reason": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1
      },
      "decisionBasis": {
        "type": "object",
        "description": "What the decision stands on. `governingRule` is the rule the decision is attributed to, carrying the reading that triggered it, the threshold it was compared against, and the provenance of that threshold. `basis` distinguishes the two kinds: external_metric means the quantity is defined outside Evidra and `sources` cite published work on it — with `contested` listing published objections to that work where they exist; internal_composite means the threshold cuts a score Evidra computes from weights it chose, so no publication can support it and `sources` is empty by design. Most rules are internal_composite. Report that plainly if asked what a decision rests on; do not describe an internal_heuristic threshold as evidence-based, and do not treat the empty source list as missing information. `evidence` grades a rule on two axes: `studyDesign` is what kind of study backs the threshold (`none` when nothing does), and `recommendationStrength` says how far that study reaches — `supports_direction_only` means it establishes that the rule should exist and which way it points, explicitly not the number. No rule is `supports_threshold` today, so never say a cited paper establishes one of these cut points. `evidenceLevel` is the older single field, derived from those two and kept for callers that read it. Each citation also carries `verificationStatus`, which describes how far anyone at Evidra has read that document and not how good the document is; `unverified` means nobody has checked it at all, and a decision resting on one should be described that way if asked. `libraryVersion` and `engineVersion` identify two things that change independently: the thresholds and their provenance, and the code that applied them. Neither is the version of the installed extension.",
        "properties": {
          "libraryVersion": { "type": "string" },
          "engineVersion": { "type": "string" },
          "policies": {
            "type": "object",
            "properties": {
              "arbitration": { "type": "string" },
              "combination": { "type": "string" }
            }
          },
          "governingRule": { "type": ["object", "null"] },
          "appliedRules": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["libraryVersion", "engineVersion", "policies", "governingRule", "appliedRules"]
      },
      "confidence": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high"
        ]
      },
      "signalCoverage": {
        "type": "object",
        "description": "Signal coverage in two groups. `recovery` covers the freshness of sleep/HRV/resting-HR/stress and vendor composites; `training` covers whether every session in the last 7 days carried a training load. A gap in either lowers confidence, and they are kept apart so a caller can tell which half is unread. The load is the vendor's own effort figure and is used as it stands — RPE is carried as evidence but is not a term in any sum, so a source that never reports one is not penalised.",
        "properties": {
          "recovery": {
            "type": "object",
            "properties": {
              "usable": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "missing": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "usable",
              "missing"
            ]
          },
          "training": {
            "type": "object",
            "properties": {
              "usable": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "missing": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "usable",
              "missing"
            ]
          }
        },
        "required": [
          "recovery",
          "training"
        ]
      },
      "limits": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "provenance": {
        "type": "object",
        "properties": {
          "evidenceSource": {
            "type": "string",
            "enum": [
              "provided",
              "demo_seed",
              "server_durable_record"
            ]
          },
          "signalWriters": {
            "type": "object",
            "description": "Where each signal came from and who wrote it, and when it was last written. Keyed by canonical signal name. A signal being listed does not make it current: compare its `latest` against the others to see a device that stopped writing.",
            "additionalProperties": {
              "type": "object",
              "properties": {
                "sources": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "What the caller said this signal came from, sorted — the `source` field on each reading. Empty when no reading of this signal stated one."
                },
                "writers": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "description": "Devices or apps that wrote this signal, sorted. Empty when the connector recorded none."
                },
                "latest": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "ISO 8601 of the most recent reading of this signal."
                },
                "baselineEstablishing": {
                  "type": "boolean",
                  "description": "True when the vendor says its own baseline for this signal is still forming — Garmin marks a daily HRV reading ONBOARDING until it has enough nights to compare against. The reading is used at full value and no penalty is applied to it; say so if the user asks how far to trust it. Absent means no vendor flagged it, not that the baseline is established."
                }
              }
            }
          }
        },
        "required": [
          "evidenceSource"
        ]
      },
      "proposal": {
        "type": "object",
        "nullable": true,
        "description": "Present only when the caller proposed an alternative. The verdict on that proposal, judged against the ceiling rules 1-7 established — never against a threshold invented for proposals.",
        "properties": {
          "verdict": {
            "type": "string",
            "enum": [
              "accepted",
              "rejected"
            ]
          },
          "violations": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "Empty when accepted. Each entry names the axis that failed and by how much."
          }
        },
        "required": [
          "verdict",
          "violations"
        ]
      }
    },
    "required": [
      "decisionId",
      "evidence",
      "state",
      "decision",
      "action",
      "reason",
      "decisionBasis",
      "confidence",
      "signalCoverage",
      "limits"
    ]
  },

  evidra_decide_exercise_substitution: {
    "type": "object",
    "properties": {
      "decisionId": { "type": "string" },
      "evidence": {
        "type": "array"
      },
      "decision": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string"
          },
          "intent": {
            "type": "string"
          }
        },
        "required": [
          "type",
          "intent"
        ]
      },
      "action": {
        "type": "object",
        "properties": {
          "from": {
            "type": "object",
            "properties": {
              "exercise_id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "equipment": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "exercise_id",
              "name"
            ],
            "nullable": true
          },
          "to": {
            "type": "object",
            "properties": {
              "exercise_id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "equipment": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "exercise_id",
              "name"
            ],
            "nullable": true
          },
          "changed": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "from",
          "to",
          "changed"
        ]
      },
      "alternatives": {
        "type": "array"
      },
      "reason": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "minItems": 1
      },
      "decisionBasis": {
        "type": "object",
        "description": "Which library rules shaped this output, in the frame evidra_decide_session uses. `governingRule` is null and `appliedRules` empty when no rule applied, and the frame still travels: an absent field cannot be told apart from a path that never checks. Each rule carries its `basis` — internal_composite means the threshold cuts a quantity Evidra computes or matches itself, so `sources` is empty by design and the rule is not evidence-based — and its `limitations`, which state what the rule does not do. Read those before describing a plan or a substitute as having been made safe.",
        "properties": {
          "libraryVersion": { "type": "string" },
          "engineVersion": { "type": "string" },
          "policies": {
            "type": "object",
            "properties": {
              "arbitration": { "type": "string" },
              "combination": { "type": "string" }
            }
          },
          "governingRule": { "type": ["object", "null"] },
          "appliedRules": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["libraryVersion", "engineVersion", "policies", "governingRule", "appliedRules"]
      },
      "confidence": {
        "type": "string"
      },
      "limits": {
        "type": "array"
      }
    },
    "required": [
      "decisionId",
      "evidence",
      "decision",
      "action",
      "reason",
      "decisionBasis",
      "confidence"
    ]
  },

  evidra_generate_plan: {
    "type": "object",
    "properties": {
      "decisionId": { "type": "string" },
      "id": {
        "type": "string"
      },
      "userId": {
        "type": "string"
      },
      "goalId": {
        "type": "string"
      },
      "name": {
        "type": "string"
      },
      "startDate": {
        "type": "string"
      },
      "endDate": {
        "type": "string"
      },
      "periodizationType": {
        "type": "string"
      },
      "status": {
        "type": "string"
      },
      "version": {
        "type": "number"
      },
      "constraints": {
        "type": "object"
      },
      "reasoning": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "decisionBasis": {
        "type": "object",
        "description": "Which library rules shaped this output, in the frame evidra_decide_session uses. `governingRule` is null and `appliedRules` empty when no rule applied, and the frame still travels: an absent field cannot be told apart from a path that never checks. Each rule carries its `basis` — internal_composite means the threshold cuts a quantity Evidra computes or matches itself, so `sources` is empty by design and the rule is not evidence-based — and its `limitations`, which state what the rule does not do. Read those before describing a plan or a substitute as having been made safe.",
        "properties": {
          "libraryVersion": { "type": "string" },
          "engineVersion": { "type": "string" },
          "policies": {
            "type": "object",
            "properties": {
              "arbitration": { "type": "string" },
              "combination": { "type": "string" }
            }
          },
          "governingRule": { "type": ["object", "null"] },
          "appliedRules": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["libraryVersion", "engineVersion", "policies", "governingRule", "appliedRules"]
      },
      "createdAt": {
        "type": "string"
      },
      "weeks": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "properties": {
            "weekIndex": {
              "type": "number"
            },
            "phase": {
              "type": "string"
            },
            "startDate": {
              "type": "string"
            },
            "loadMultiplier": {
              "type": "number"
            },
            "sessions": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "dayOfWeek": {
                    "type": "string"
                  },
                  "date": {
                    "type": "string"
                  },
                  "focus": {
                    "type": "string"
                  },
                  "type": {
                    "type": "string"
                  },
                  "durationMinutes": {
                    "type": "number"
                  },
                  "intensity": {
                    "type": "string"
                  },
                  "targetMuscleGroups": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "exerciseIds": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "Canonical exercise ids — the form decisions and storage reference."
                  },
                  "exercises": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "The same movements spoken for a human; derived from exerciseIds, never authored separately."
                  },
                  "rationale": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "date",
                  "focus",
                  "type",
                  "durationMinutes",
                  "exerciseIds",
                  "exercises"
                ]
              }
            }
          },
          "required": [
            "weekIndex",
            "phase",
            "startDate",
            "loadMultiplier",
            "sessions"
          ]
        }
      }
    },
    "required": [
      "decisionId",
      "id",
      "userId",
      "goalId",
      "name",
      "startDate",
      "endDate",
      "periodizationType",
      "status",
      "version",
      "constraints",
      "weeks",
      "reasoning",
      "decisionBasis",
      "createdAt"
    ]
  },

  evidra_generate_workout: {
    type: "object",
    properties: {
      tool: { type: "string" }, decisionId: { type: "string" }, userId: { type: "string" }, date: { type: "string" },
      request: { type: "object", properties: { durationMinutes: { type: "number" }, focus: { type: "string" } }, required: ["durationMinutes", "focus"] },
      decision: { type: "object", properties: { type: { type: "string" }, intent: { type: "string" }, adjustment: { type: "object" } }, required: ["type", "intent", "adjustment"] },
      action: { type: "object" }, workout: { type: "object" }, reason: { type: "array", items: { type: "string" } },
      decisionBasis: { type: "object" }, confidence: { type: "string" }, signalCoverage: { type: "object" }, provenance: { type: "object" }
    },
    required: ["tool", "decisionId", "userId", "date", "request", "decision", "action", "workout", "reason", "decisionBasis", "confidence", "signalCoverage", "provenance"]
  },

  evidra_preview_adjust_plan: {
    "type": "object",
    "properties": {
      "decisionId": { "type": "string" },
      "previewId": {
        "type": "string"
      },
      "planId": {
        "type": "string"
      },
      "baseVersion": {
        "type": "number"
      },
      "summary": {
        "type": "string"
      },
      "diff": {
        "type": "array"
      },
      "note": {
        "type": "string"
      },
      "decisionBasis": {
        "type": "object",
        "description": "Which library rules shaped this output, in the frame evidra_decide_session uses. `governingRule` is null and `appliedRules` empty when no rule applied, and the frame still travels: an absent field cannot be told apart from a path that never checks. Each rule carries its `basis` — internal_composite means the threshold cuts a quantity Evidra computes or matches itself, so `sources` is empty by design and the rule is not evidence-based — and its `limitations`, which state what the rule does not do. Read those before describing a plan or a substitute as having been made safe.",
        "properties": {
          "libraryVersion": { "type": "string" },
          "engineVersion": { "type": "string" },
          "policies": {
            "type": "object",
            "properties": {
              "arbitration": { "type": "string" },
              "combination": { "type": "string" }
            }
          },
          "governingRule": { "type": ["object", "null"] },
          "appliedRules": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["libraryVersion", "engineVersion", "policies", "governingRule", "appliedRules"]
      },
      "patch": {
        "type": "object"
      }
    },
    "required": [
      "decisionId",
      "previewId",
      "planId",
      "baseVersion",
      "summary",
      "diff",
      "decisionBasis",
      "patch"
    ]
  },

  evidra_commit_adjust_plan: {
    "type": "object",
    "properties": {
      "decisionId": { "type": "string" },
      "previewDecisionId": { "type": ["string", "null"] },
      "planId": {
        "type": "string"
      },
      "version": {
        "type": "number"
      },
      "status": {
        "type": "string"
      },
      "plan": {
        "type": "object"
      },
      "decisionBasis": {
        "type": ["object", "null"],
        "description": "Which library rules shaped this output, in the frame evidra_decide_session uses. `governingRule` is null and `appliedRules` empty when no rule applied, and the frame still travels: an absent field cannot be told apart from a path that never checks. Each rule carries its `basis` — internal_composite means the threshold cuts a quantity Evidra computes or matches itself, so `sources` is empty by design and the rule is not evidence-based — and its `limitations`, which state what the rule does not do. Read those before describing a plan or a substitute as having been made safe. Carried from the preview being committed rather than recomputed, and null when that preview predates the field.",
        "properties": {
          "libraryVersion": { "type": "string" },
          "engineVersion": { "type": "string" },
          "policies": {
            "type": "object",
            "properties": {
              "arbitration": { "type": "string" },
              "combination": { "type": "string" }
            }
          },
          "governingRule": { "type": ["object", "null"] },
          "appliedRules": { "type": "array", "items": { "type": "object" } }
        },
        "required": ["libraryVersion", "engineVersion", "policies", "governingRule", "appliedRules"]
      },
      "versionHistory": {
        "type": "array",
        "description": "How the plan reached this version, as from -> to. The server holds no history, so the earlier entries are the ones carried by the supplied plan and the last entry is the commit just made. Keep the array to keep the chain.",
        "items": {
          "type": "object",
          "properties": {
            "version": {
              "type": "number",
              "description": "The version this entry produced."
            },
            "fromVersion": {
              "type": "number",
              "description": "The version it was built against."
            },
            "previewId": {
              "type": "string",
              "description": "The preview that was committed."
            },
            "change": {
              "type": [
                "string",
                "null"
              ],
              "description": "The kind of change requested, or null when the preview did not name one."
            },
            "summary": {
              "type": [
                "string",
                "null"
              ],
              "description": "What the change did, in the preview's own words."
            }
          },
          "required": [
            "version",
            "fromVersion",
            "previewId"
          ]
        }
      }
    },
    "required": [
      "decisionId",
      "planId",
      "version",
      "status",
      "plan",
      "versionHistory"
    ]
  },
  get_evidence_coverage: {
    type: "object",
    properties: {
      userId: { type: ["string", "null"] },
      coverageScore: { type: "number" },
      quality: { type: "string", enum: ["low", "medium", "high"] },
      qualityWarnings: { type: "array", items: { type: "string" } },
      coverage: { type: "object" },
      sources: { type: "array", items: { type: "string" } },
      missing: { type: "array", items: { type: "string" } },
      provenance: { type: "object" }
    },
    required: ["coverageScore", "quality", "qualityWarnings", "coverage", "sources", "missing"]
  },
  explain_decision: {
    type: "object",
    properties: {
      decisionId: { type: "string" },
      createdAt: { type: "number" },
      userId: { type: ["string", "null"] },
      evidenceSource: { type: "string" },
      trace: { type: "object" }
    },
    required: ["decisionId", "createdAt", "trace"]
  },
  submit_outcome: {
    type: "object",
    properties: {
      caseId: { type: "string" },
      event: { type: "object" },
      totalForCase: { type: "number" },
      persistence: { type: "string", enum: ["process_local", "user_controlled_repository"] },
      runtimeIdentity: { type: "object" },
      note: { type: "string" }
    },
    required: ["caseId", "event", "totalForCase", "persistence"]
  }
};
