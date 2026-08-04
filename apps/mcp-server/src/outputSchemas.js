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
  assess_fitness_state: {
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
              "demo_seed"
            ]
          },
          "signalWriters": {
            "type": "object",
            "description": "Who wrote each signal, and when they last did. Keyed by canonical signal name. Present when the evidence carried writer information at all. A signal being listed does not make it current: compare its `latest` against the others to see a device that stopped writing.",
            "additionalProperties": {
              "type": "object",
              "properties": {
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

  decide_session: {
    "type": "object",
    "properties": {
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
              "demo_seed"
            ]
          },
          "signalWriters": {
            "type": "object",
            "description": "Who wrote each signal, and when they last did. Keyed by canonical signal name. Present when the evidence carried writer information at all. A signal being listed does not make it current: compare its `latest` against the others to see a device that stopped writing.",
            "additionalProperties": {
              "type": "object",
              "properties": {
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
      "evidence",
      "state",
      "decision",
      "action",
      "reason",
      "confidence",
      "signalCoverage",
      "limits"
    ]
  },

  decide_exercise_substitution: {
    "type": "object",
    "properties": {
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
      "confidence": {
        "type": "string"
      },
      "limits": {
        "type": "array"
      }
    },
    "required": [
      "evidence",
      "decision",
      "action",
      "reason",
      "confidence"
    ]
  },

  generate_plan: {
    "type": "object",
    "properties": {
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
      "createdAt"
    ]
  },

  preview_adjust_plan: {
    "type": "object",
    "properties": {
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
      "patch": {
        "type": "object"
      }
    },
    "required": [
      "previewId",
      "planId",
      "baseVersion",
      "summary",
      "diff",
      "patch"
    ]
  },

  commit_adjust_plan: {
    "type": "object",
    "properties": {
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
      "planId",
      "version",
      "status",
      "plan",
      "versionHistory"
    ]
  }
};
