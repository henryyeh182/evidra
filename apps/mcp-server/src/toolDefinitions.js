export const toolDefinitions = [
  {
    name: "assess_fitness_state",
    title: "Assess Fitness State",
    annotations: {
      title: "Assess Fitness State",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description: "Return the user's computed Semantic Fitness State for a date.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: {
          type: "object",
          description:
            "The user's health evidence, passed in by the AI layer that holds their authorization. Source-neutral: normalize Apple Health / Garmin / Oura / Whoop / Strava into this shape. The server does not fetch or store evidence. Omit only for local demo runs.",
          properties: {
            profile: { type: "object", description: "timezone, fitnessLevel." },
            goals: { type: "array", items: { type: "object" }, description: "Training goals, highest priority first." },
            constraints: {
              type: "object",
              description: "injuries[], equipment[], availableMinutes, avoidMovements[]."
            },
            healthMetrics: {
              type: "array",
              items: { type: "object" },
              description: "Recent readings: sleep_duration_hours, sleep_quality, hrv_ms, resting_hr_bpm, steps, stress — each with value, recordedAt, source."
            },
            workouts: {
              type: "array",
              items: { type: "object" },
              description: "Completed sessions with startedAt, durationMinutes, type, rpe, trainingLoad, muscleGroups."
            }
          }
        },
        userId: {
          type: "string",
          description: "User identifier."
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today in the user's timezone, resolved by the server (demo fallback anchors to the seed's latest day)."
        }
      },
      required: ["userId"]
    }
  },
  {
    name: "recommend_workout",
    deprecated: true,
    description: "Return today's recommended workout focus and reasoning from the Semantic Fitness Layer.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User identifier."
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today in the user's timezone, resolved by the server (demo fallback anchors to the seed's latest day)."
        },
        includeStravaFixture: {
          type: "boolean",
          description: "Include the local Strava fixture before generating the recommendation."
        }
      },
      required: ["userId"]
    }
  },
  {
    name: "decide_session",
    title: "Decide Today's Session",
    annotations: {
      title: "Decide Today's Session",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Decide what today's SCHEDULED session should become, given today's evidence. Returns a decision with from -> to: the session as planned, and what it should be changed to, with the evidence and reasoning behind it. Use this for 'what should I train today', 'am I ready for today's session', or 'should I adjust today's workout'. This is a decision, not a suggestion — it requires a stored plan. Do NOT use this to look up state alone (use get_semantic_fitness_state), and do NOT re-derive or override the intensity it returns: injury filtering is a hard safety rule.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: {
          type: "object",
          description:
            "The user's health evidence, passed in by the AI layer that holds their authorization. Source-neutral: normalize Apple Health / Garmin / Oura / Whoop / Strava into this shape. The server does not fetch or store evidence. Omit only for local demo runs.",
          properties: {
            profile: { type: "object", description: "timezone, fitnessLevel." },
            goals: { type: "array", items: { type: "object" }, description: "Training goals, highest priority first." },
            constraints: {
              type: "object",
              description: "injuries[], equipment[], availableMinutes, avoidMovements[]."
            },
            healthMetrics: {
              type: "array",
              items: { type: "object" },
              description: "Recent readings: sleep_duration_hours, sleep_quality, hrv_ms, resting_hr_bpm, steps, stress — each with value, recordedAt, source."
            },
            workouts: {
              type: "array",
              items: { type: "object" },
              description: "Completed sessions with startedAt, durationMinutes, type, rpe, trainingLoad, muscleGroups."
            }
          }
        },
        userId: { type: "string", description: "User identifier." },
        date: { type: "string", description: "Date in YYYY-MM-DD. Defaults to today in the user's timezone, resolved by the server (demo fallback anchors to the seed's latest day)." },
        scheduledSession: {
          type: "object",
          description:
            "Today's session as already planned — the prior state this decision acts on. Supply it from the agent's own memory of the user's plan; without it there is nothing to decide, only to suggest. Shape: {focus, type, durationMinutes, intensity, targetMuscleGroups[], exercises[]}.",
          properties: {
            focus: { type: "string" },
            type: { type: "string" },
            durationMinutes: { type: "number" },
            intensity: { type: "string", enum: ["low", "moderate", "high"] },
            targetMuscleGroups: { type: "array", items: { type: "string" } },
            exercises: { type: "array", items: { type: "string" } }
          }
        },
        proposedSession: {
          type: "object",
          description:
            "What the athlete asked for instead — the alternative they proposed, judged against what today can carry. Supply it when the user names a specific option (today was cardio, can I do mobility work instead?). Without it the engine answers only what today should be, leaving the person's own suggestion unaddressed. Same shape as scheduledSession.",
          properties: {
            focus: { type: "string" },
            type: { type: "string" },
            durationMinutes: { type: "number" },
            intensity: { type: "string", enum: ["low", "moderate", "high"] },
            targetMuscleGroups: { type: "array", items: { type: "string" } },
            exercises: { type: "array", items: { type: "string" } }
          }
        },
        planId: { type: "string", description: "Local demo only: look up the session in a stored plan instead of supplying it." },
        availableMinutes: { type: "number", description: "Override today's available time, e.g. when the user says they are busy." },
        includeStravaFixture: { type: "boolean", description: "Include the local Strava fixture as extra evidence." }
      },
      required: ["userId"]
    }
  },
  {
    name: "decide_exercise_substitution",
    title: "Decide Exercise Substitution",
    annotations: {
      title: "Decide Exercise Substitution",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Decide what a movement the user cannot do today should be replaced with. Returns a decision with from -> to: the original exercise and the one it becomes, plus the evidence behind the swap. Injury contraindications are a hard filter applied server-side — do NOT override or reason past the result. Use this when a specific exercise hurts or the equipment is unavailable. Do NOT use it to browse exercises.",
    inputSchema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "The exercise being replaced." },
        conditions: { type: "array", items: { type: "string" }, description: "Situation, e.g. ['knee_injury', 'no_equipment']." },
        availableEquipment: { type: "array", items: { type: "string" }, description: "Equipment the user actually has." },
        avoidContraindications: { type: "array", items: { type: "string" }, description: "Joints to protect, e.g. ['knee']." }
      },
      required: ["exerciseId"]
    }
  },
  {
    name: "search_exercises",
    deprecated: true,
    description:
      "Search the exercise library by muscle, movement pattern, equipment, skill, and impact. Returns exercise_id for every hit, so results can be passed to get_exercise. Use this to answer 'what exercises can I do for X'. Do NOT use this to pick what to train today (use recommend_workout, which accounts for fatigue and recovery), and do NOT use it to look up a single exercise you already have an id for (use get_exercise).",
    inputSchema: {
      type: "object",
      properties: {
        muscle: { type: "string", description: "Specific muscle, e.g. 'quads', 'chest', 'glutes'." },
        muscleGroup: { type: "string", enum: ["upper", "lower", "core"], description: "Coarse body region." },
        movementPattern: {
          type: "string",
          description: "One of: squat, hinge, horizontal_push, vertical_push, horizontal_pull, vertical_pull, locomotion, mobility, core, isolation, plyometric."
        },
        availableEquipment: {
          type: "array",
          items: { type: "string" },
          description: "Equipment the user has. Pass [] for bodyweight-only. Omit to ignore equipment."
        },
        excludeContraindications: {
          type: "array",
          items: { type: "string" },
          description: "Joints to protect, e.g. ['knee']. Matching exercises are hard-filtered out."
        },
        maxImpact: { type: "string", enum: ["low", "moderate", "high"], description: "Highest acceptable joint impact." },
        skillLevel: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
        limit: { type: "number", description: "Page size, 1-50. Defaults to 20." },
        offset: { type: "number", description: "Pagination offset. Defaults to 0." }
      }
    }
  },
  {
    name: "get_exercise",
    deprecated: true,
    description:
      "Return full detail for one exercise plus its graph neighbours: variants, progressions, regressions, and safe substitutes. Use this when the user asks about a specific exercise or wants an alternative to it. Do NOT use this to browse or filter the library (use search_exercises).",
    inputSchema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Exercise identifier returned by search_exercises." },
        conditions: {
          type: "array",
          items: { type: "string" },
          description: "Situational filters for substitutes, e.g. ['knee_injury', 'no_equipment']."
        },
        availableEquipment: { type: "array", items: { type: "string" }, description: "Restrict substitutes to usable equipment." },
        avoidContraindications: { type: "array", items: { type: "string" }, description: "Joints to protect in substitutes, e.g. ['knee']." }
      },
      required: ["exerciseId"]
    }
  },
  {
    name: "search_workouts",
    deprecated: true,
    description:
      "Search the structured workout library by intensity zone, duration, equipment, and body region. Answers queries the underlying data supports exactly, such as 'a session entirely in Zone 2' or 'upper body only, no equipment, under 30 minutes'. Do NOT use this for the user's completed training history (use get_training_history).",
    inputSchema: {
      type: "object",
      properties: {
        inZone: { type: "number", description: "Require every set to sit in this HR zone, e.g. 2." },
        maxDurationMinutes: { type: "number", description: "Longest acceptable session length." },
        availableEquipment: { type: "array", items: { type: "string" }, description: "Equipment the user has. Pass [] for bodyweight-only." },
        muscleGroup: { type: "string", enum: ["upper", "lower", "core"] },
        limit: { type: "number", description: "Page size, 1-50. Defaults to 20." },
        offset: { type: "number", description: "Pagination offset. Defaults to 0." }
      }
    }
  },
  {
    name: "get_workout",
    deprecated: true,
    description:
      "Return the complete Block/Set structure of one workout, with every set resolved to a real exercise. Returns structured data, never a prose description. Use this before describing what a session actually contains.",
    inputSchema: {
      type: "object",
      properties: {
        workoutId: { type: "string", description: "Workout identifier returned by search_workouts." }
      },
      required: ["workoutId"]
    }
  },
  {
    name: "get_user_profile",
    deprecated: true,
    description:
      "Return the user's goals, preferences, active injuries, and available equipment. Use this to learn the constraints that apply to any recommendation. Do NOT use this for past sessions (use get_training_history) or for today's readiness (use get_semantic_fitness_state).",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier." }
      },
      required: ["userId"]
    }
  },
  {
    name: "get_training_history",
    deprecated: true,
    description:
      "Return the user's completed workouts, always sorted newest-first by the server. Use this for questions about what the user actually did. Do NOT re-sort or re-rank the results, and do NOT use this to browse the workout library (use search_workouts).",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier." },
        since: { type: "string", description: "Only include workouts on/after this ISO date, e.g. '2026-07-01'." },
        type: { type: "string", description: "Filter by workout type, e.g. 'run', 'strength'." },
        includeStravaFixture: { type: "boolean", description: "Include the local Strava fixture." },
        limit: { type: "number", description: "Page size, 1-50. Defaults to 20." },
        offset: { type: "number", description: "Pagination offset. Defaults to 0." }
      },
      required: ["userId"]
    }
  },
  {
    name: "get_training_context",
    deprecated: true,
    description: "Deprecated: use get_user_profile and get_training_history instead. Returns normalized profile, goals, workouts, health metric counts, and available tools context.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User identifier."
        },
        includeStravaFixture: {
          type: "boolean",
          description: "Include the local Strava fixture in the returned context."
        }
      },
      required: ["userId"]
    }
  },
  {
    name: "generate_plan",
    title: "Generate Training Plan",
    annotations: {
      title: "Generate Training Plan",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description: "Generate and store a deterministic periodized multi-week training plan from the user's goals and constraints.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: {
          type: "object",
          description:
            "The user's health evidence, passed in by the AI layer that holds their authorization. Source-neutral: normalize Apple Health / Garmin / Oura / Whoop / Strava into this shape. The server does not fetch or store evidence. Omit only for local demo runs.",
          properties: {
            profile: { type: "object", description: "timezone, fitnessLevel." },
            goals: { type: "array", items: { type: "object" }, description: "Training goals, highest priority first." },
            constraints: {
              type: "object",
              description: "injuries[], equipment[], availableMinutes, avoidMovements[]."
            },
            healthMetrics: {
              type: "array",
              items: { type: "object" },
              description: "Recent readings: sleep_duration_hours, sleep_quality, hrv_ms, resting_hr_bpm, steps, stress — each with value, recordedAt, source."
            },
            workouts: {
              type: "array",
              items: { type: "object" },
              description: "Completed sessions with startedAt, durationMinutes, type, rpe, trainingLoad, muscleGroups."
            }
          }
        },
        userId: { type: "string", description: "User identifier." },
        goalId: { type: "string", description: "Goal to build the plan around. Defaults to the highest-priority goal." },
        weeks: { type: "number", description: "Number of weeks to plan. Defaults to 4." },
        startDate: { type: "string", description: "Plan start date in YYYY-MM-DD format (ideally a Monday). Defaults to today in the user's timezone." }
      },
      required: ["userId"]
    }
  },
  {
    name: "get_plan",
    deprecated: true,
    description: "Return a stored training plan by id, including weeks, sessions, and version history.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan identifier returned by generate_plan." }
      },
      required: ["planId"]
    }
  },
  {
    name: "list_plans",
    deprecated: true,
    description: "List stored training plan summaries for a user.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier." }
      },
      required: ["userId"]
    }
  },
  {
    name: "preview_adjust_plan",
    title: "Preview Plan Adjustment",
    annotations: {
      title: "Preview Plan Adjustment",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description: "Preview a non-destructive change to a stored plan (reduce availability, add injury, or deload a week) and return the diff. Nothing is committed until commit_adjust_plan is called.",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Plan identifier to modify." },
        changeRequest: {
          type: "object",
          description: "One of: {kind:'reduce_availability', weekdayAvailableMinutes, weekIndexes?}, {kind:'add_injury', bodyRegion, restrictions?, avoidMovements?}, or {kind:'deload_week', weekIndex}.",
          properties: {
            kind: { type: "string", enum: ["reduce_availability", "add_injury", "deload_week"] }
          },
          required: ["kind"]
        }
      },
      required: ["planId", "changeRequest"]
    }
  },
  {
    name: "commit_adjust_plan",
    title: "Commit Plan Adjustment",
    annotations: {
      title: "Commit Plan Adjustment",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description: "Commit a previously previewed plan change. Requires the previewId from preview_adjust_plan and bumps the plan version.",
    inputSchema: {
      type: "object",
      properties: {
        previewId: { type: "string", description: "Preview identifier returned by preview_adjust_plan." }
      },
      required: ["previewId"]
    }
  }
];

// Deprecated tool names kept as aliases for one version so already-connected
// clients that cached the old names keep working after the D-TOOL rename to the
// canonical surface. New clients discover only the canonical names via
// tools/list. Remove after the next release.
export const deprecatedToolAliases = {
  get_semantic_fitness_state: "assess_fitness_state",
  recommend_today_workout: "recommend_workout",
  generate_training_plan: "generate_plan",
  get_training_plan: "get_plan",
  list_training_plans: "list_plans",
  preview_plan_change: "preview_adjust_plan",
  commit_plan_change: "commit_adjust_plan"
};

export function resolveToolName(name) {
  return deprecatedToolAliases[name] || name;
}

/**
 * Tools advertised to clients. Deprecated tools stay callable for one release
 * but are hidden from discovery, so new conversations only see the canonical
 * surface and the tool budget (R2) reflects what models actually choose from.
 */
export function listedToolDefinitions() {
  return toolDefinitions
    .filter((tool) => !tool.deprecated)
    .map(({ deprecated, ...tool }) => tool);
}

export function getToolDefinition(name) {
  const canonical = resolveToolName(name);
  return toolDefinitions.find((tool) => tool.name === canonical);
}
