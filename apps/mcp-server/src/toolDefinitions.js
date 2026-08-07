// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import {
  EVIDENCE_METRIC_TYPES,
  EVIDENCE_VENDOR_ASSESSMENT_TYPES
} from "../../../packages/evidence/src/index.js";

import { outputSchemas } from "./outputSchemas.js";

/**
 * The evidence object, written once.
 *
 * Three tools take it and each carried its own copy of the same forty lines,
 * which is how `healthMetrics` ended up describing its fields in a sentence
 * instead of typing them: prose is cheap to duplicate, a schema is not. The
 * constraints below are the ones `packages/evidence/src/model.js` already
 * enforces, so a caller that validates its own arguments learns that
 * `sleepDurationHours` is not a metric type before spending a round trip to
 * find out.
 */
const EVIDENCE_INPUT = {
  type: "object",
  description:
    "The user's health evidence, gathered and passed in by the AI layer that holds their authorization. Source-neutral: normalize whatever the athlete has — Apple Health, Google Health, Garmin, Strava, Oura, Whoop — into this shape, or build it from what they tell you. Omit only for local demo runs.",
  properties: {
    profile: {
      type: "object",
      description: "timezone, fitnessLevel.",
      properties: {
        timezone: {
          type: "string",
          description: "IANA zone name, e.g. Asia/Taipei — not an abbreviation and not a UTC offset. Defaults to UTC."
        },
        fitnessLevel: { type: "string", enum: ["beginner", "intermediate", "advanced"] }
      }
    },
    goals: { type: "array", items: { type: "object" }, description: "Training goals, highest priority first." },
    constraints: {
      type: "object",
      description: "injuries[], equipment[], availableMinutes, avoidMovements[]."
    },
    healthMetrics: {
      type: "array",
      description:
        "Recent readings, one entry per measurement. Send what exists; anything absent is reported in signalCoverage and lowers confidence.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [...EVIDENCE_METRIC_TYPES],
            description: "Canonical and case-sensitive: sleepDurationHours is not sleep_duration_hours."
          },
          value: { type: "number" },
          recordedAt: { type: "string", description: "ISO 8601 timestamp." },
          source: { type: "string", description: "Where the reading came from, e.g. garmin | strava | apple_health." }
        },
        required: ["type", "value", "recordedAt"]
      }
    },
    vendorAssessments: {
      type: "array",
      description:
        "Composite scores the device maker computed, sent as they stand rather than recomputed: Garmin Body Battery, Oura or Whoop readiness, Garmin recovery time. Send these when the source has them — they carry more of the athlete's state than any raw signal, because the vendor integrated sensors this server never sees, and the recovery score weights them above the raw readings accordingly. A source that publishes one and does not send it here is decided about on less than it had.",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [...EVIDENCE_VENDOR_ASSESSMENT_TYPES],
            description:
              "Canonical and case-sensitive. vendor_readiness covers any vendor's own readiness or recovery score (Oura Readiness, Whoop Recovery); body_battery is Garmin's."
          },
          value: { type: "number", description: "As the vendor reports it; the 0-100 scores are not rescaled." },
          recordedAt: { type: "string", description: "ISO 8601 timestamp." },
          source: { type: "string", description: "e.g. garmin | oura | whoop." }
        },
        required: ["type", "value", "recordedAt"]
      }
    },
    workouts: {
      type: "array",
      description: "Completed sessions, usually the last 7-28 days.",
      items: {
        type: "object",
        properties: {
          startedAt: { type: "string", description: "ISO 8601 timestamp." },
          durationMinutes: { type: "number" },
          type: { type: "string", description: "e.g. run | strength | recovery." },
          rpe: { type: "number", description: "Carried as evidence; it is not a term in any computation." },
          trainingLoad: {
            type: "number",
            description:
              "The vendor's own effort figure, used as it stands. A session without one is reported in signalCoverage.training.missing rather than counted as zero fatigue."
          },
          muscleGroups: { type: "array", items: { type: "string" } }
        },
        required: ["startedAt", "durationMinutes"]
      }
    }
  }
};

export const toolDefinitions = [
  {
    name: "evidra_assess_fitness_state",
    title: "Assess Fitness State",
    annotations: {
      title: "Assess Fitness State",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Report how the user is doing today: recovery, readiness, muscle-group fatigue and training load, each with the evidence behind it and an honest list of what could not be seen. Use this for 'how am I doing today', 'have I recovered', 'am I overtraining', 'how is my training load'. Pass the user's recent health evidence as `evidence`, gathered from whichever health source this user actually has — Apple Health, Google Health, Garmin, Strava, Oura, Whoop or any other; the shape is the same and no one source is expected — or, where they have none, from the user directly: what a person says about their own week is evidence, and 'slept about seven hours, legs feel fine, last hard run was Tuesday' is enough to compute on. Any single source decides something; a signal nobody supplied comes back in signalCoverage and lowers confidence, so the decision still stands — on less, and visibly so. This reports state only — it never says what to train. If the user has a session scheduled and wants to know whether to do it, use evidra_decide_session; if they have no plan at all, use evidra_generate_plan.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: EVIDENCE_INPUT,
        userId: {
          type: "string",
          description: "User identifier."
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today in the user's timezone, resolved by the server."
        }
      },
      required: ["evidence"]
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
          description: "Date in YYYY-MM-DD format. Defaults to the demo seed's latest day (this tool is demo-seed only)."
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
    name: "evidra_decide_session",
    title: "Decide Today's Session",
    annotations: {
      title: "Decide Today's Session",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Decide what today's scheduled session should become, given today's evidence. Returns a decision with from -> to: the session as planned, what it should change to, and the evidence and rules behind the change. Use this for questions about a session that is already on the books: 'am I ready for today's session', 'today's plan says intervals — should I still do them', 'should I adjust today's workout', 'I only have 30 minutes today'. `scheduledSession` is what makes this a decision: called without it, this tool returns no_scheduled_session and decides nothing, so for an open-ended 'what should I train today' with no plan in hand, call evidra_generate_plan instead. If the user proposes their own alternative — 'today was cardio, can I do stretching instead?' — pass that as `proposedSession` and it comes back accepted or refused, with the reason. Pass the user's recent health evidence as `evidence`, gathered from whichever health source this user actually has — Apple Health, Google Health, Garmin, Strava, Oura, Whoop or any other; the shape is the same and no one source is expected — or, where they have none, from the user directly: what a person says about their own week is evidence, and 'slept about seven hours, legs feel fine, last hard run was Tuesday' is enough to compute on. Any single source decides something; a signal nobody supplied comes back in signalCoverage and lowers confidence, so the decision still stands — on less, and visibly so. This is a decision, not a suggestion: it requires a scheduled session and decides about an existing plan rather than inventing one. Do NOT re-derive or override the intensity, duration or movements it returns — injury filtering and load limits are enforced server-side and are decisions, not advice. To look up state alone, use evidra_assess_fitness_state.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: EVIDENCE_INPUT,
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
        plan: { type: "object", description: "Optional caller-held plan metadata; the server does not look up plans." },
        availableMinutes: { type: "number", description: "Override today's available time, e.g. when the user says they are busy." }
      },
      required: ["evidence"]
    }
  },
  {
    name: "evidra_decide_exercise_substitution",
    title: "Decide Exercise Substitution",
    annotations: {
      title: "Decide Exercise Substitution",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Decide what a movement the user cannot do today should be replaced with. Returns a decision with from -> to: the original exercise, the one it becomes, and the evidence behind the swap, including whether the training stimulus survived the change. Use this for 'my knee hurts when I squat', 'I have no barbell today', 'what can I do instead of X'. Pass `exerciseId` as the movement the user named, in their own words — the server resolves names and aliases to the catalog itself. This decision is made from the movement plus what the user says about their situation — pass that as `conditions`, `availableEquipment` and `avoidContraindications`. It reads no recovery or training-load signals, so there is no health evidence to gather first. Injury contraindications are a hard filter applied server-side — do NOT override or reason past the result. Do NOT use this to browse exercises.",
    inputSchema: {
      type: "object",
      properties: {
        exerciseId: {
          type: "string",
          description:
            "The exercise being replaced. Accepts the movement as the user said it ('back squat', 'bench'), a catalog name, or a canonical exercise_* id — all are resolved server-side."
        },
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
      "Return the user's goals, preferences, active injuries, and available equipment. Use this to learn the constraints that apply to any recommendation. Do NOT use this for past sessions (use get_training_history) or for today's readiness (use evidra_assess_fitness_state).",
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
    name: "evidra_generate_plan",
    title: "Generate Training Plan",
    annotations: {
      title: "Generate Training Plan",
      // Read-only because nothing here has an environment to modify: the plan is
      // returned, never stored, and the caller decides whether to keep it. The
      // hints said otherwise, which told hosts to treat a pure computation as a
      // write. evidra_commit_adjust_plan keeps `readOnlyHint: false` for the opposite
      // reason — it also stores nothing, but it must not be called without the
      // user having seen and accepted the preview.
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Build a multi-week training plan from the user's goal, available days and equipment — the baseline that later daily decisions adjust. Use this for 'make me a training plan', 'I want to train for a half marathon', 'give me a 4-week program'. Pass the user's recent training history as `evidence`, from their connectors or from what they tell you — 'I've been running about three times a week' is evidence — so the plan starts from the load they are actually carrying rather than from zero. Weeks are periodized, and every movement it prescribes resolves to a real catalog entry.",
    inputSchema: {
      type: "object",
      properties: {
        evidence: EVIDENCE_INPUT,
        userId: { type: "string", description: "User identifier." },
        goalId: { type: "string", description: "Goal to build the plan around. Defaults to the highest-priority goal." },
        weeks: { type: "number", description: "Number of weeks to plan. Defaults to 4." },
        startDate: { type: "string", description: "Plan start date in YYYY-MM-DD format (ideally a Monday). Defaults to today in the user's timezone." }
      },
      required: ["evidence"]
    }
  },
  {
    name: "get_plan",
    deprecated: true,
    description: "Return a caller-supplied training plan. The server does not store plans.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "The caller-held training plan." }
      },
      required: ["plan"]
    }
  },
  {
    name: "list_plans",
    deprecated: true,
    description: "Summarize caller-supplied training plans. The server does not store plans.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier." },
        plans: { type: "array", items: { type: "object" }, description: "Plans held by the caller." }
      },
      required: ["userId", "plans"]
    }
  },
  {
    name: "evidra_preview_adjust_plan",
    title: "Preview Plan Adjustment",
    annotations: {
      title: "Preview Plan Adjustment",
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Preview a change to the caller-supplied plan without mutating it. Use this for 'I am busy this week', 'my knee hurts, adjust my plan', 'I want an easier week'. Returns a deterministic preview patch; the AI host or external storage owns retention and commit.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "The caller-held plan to modify." },
        changeRequest: {
          type: "object",
          description: "One of: {kind:'reduce_availability', weekdayAvailableMinutes, weekIndexes?}, {kind:'add_injury', bodyRegion, restrictions?, avoidMovements?}, or {kind:'deload_week', weekIndex}.",
          properties: {
            kind: { type: "string", enum: ["reduce_availability", "add_injury", "deload_week"] }
          },
          required: ["kind"]
        }
      },
      required: ["plan", "changeRequest"]
    }
  },
  {
    name: "evidra_commit_adjust_plan",
    title: "Commit Plan Adjustment",
    annotations: {
      title: "Commit Plan Adjustment",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      "Validate and materialize a caller-held preview patch after approval. Use this after evidra_preview_adjust_plan, once the user has agreed to what the preview showed: 'yes, do that', 'apply it', 'go ahead and change my plan', 'sounds good, update it'. Approval is the trigger — never call this on the strength of a preview the user has not seen and accepted. The server stores neither the plan nor the preview; the AI host or external storage must persist the returned plan. A preview built against an older version is refused.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "object", description: "The current caller-held plan." },
        preview: { type: "object", description: "The patch returned by evidra_preview_adjust_plan." }
      },
      required: ["plan", "preview"]
    }
  }
];

// Deprecated tool names kept as aliases for one version so already-connected
// clients that cached the old names keep working after the D-TOOL rename to the
// canonical surface. New clients discover only the canonical names via
// tools/list. Remove after the next release.
export const deprecatedToolAliases = {
  get_semantic_fitness_state: "evidra_assess_fitness_state",
  recommend_today_workout: "recommend_workout",
  generate_training_plan: "evidra_generate_plan",
  get_training_plan: "get_plan",
  list_training_plans: "list_plans",
  preview_plan_change: "evidra_preview_adjust_plan",
  commit_plan_change: "evidra_commit_adjust_plan",

  // The unprefixed names, which unlike the rest of this map were actually
  // published: v0.1.0 and v0.1.1 both shipped them. A server name prefix is
  // what keeps `generate_plan` from colliding with every other planner a host
  // has connected, but anyone who installed either bundle holds the old names,
  // so they keep resolving.
  assess_fitness_state: "evidra_assess_fitness_state",
  decide_session: "evidra_decide_session",
  decide_exercise_substitution: "evidra_decide_exercise_substitution",
  generate_plan: "evidra_generate_plan",
  preview_adjust_plan: "evidra_preview_adjust_plan",
  commit_adjust_plan: "evidra_commit_adjust_plan"
};

export function resolveToolName(name) {
  return deprecatedToolAliases[name] || name;
}

/**
 * Tools advertised to clients. Deprecated tools stay callable for one release
 * but are hidden from discovery, so new conversations only see the canonical
 * surface and the tool budget (R2) reflects what models actually choose from.
 *
 * The output schema is attached here rather than written into each definition:
 * only advertised tools have a contract worth declaring, and doing it in one
 * place means a new tool cannot quietly ship without one.
 */
export function listedToolDefinitions() {
  return toolDefinitions
    .filter((tool) => !tool.deprecated)
    .map(({ deprecated, ...tool }) => ({
      ...tool,
      ...(outputSchemas[tool.name] ? { outputSchema: outputSchemas[tool.name] } : {})
    }));
}

/**
 * The output schema a tool declares, if it declares one.
 *
 * Only the advertised tools do. A structured result is the answer to a declared
 * schema, so this is also what decides whether one is sent: handing a client a
 * structured object that no contract covers means paying for the payload twice
 * and promising nothing in return.
 */
export function outputSchemaFor(name) {
  return outputSchemas[resolveToolName(name)] || null;
}

export function getToolDefinition(name) {
  const canonical = resolveToolName(name);
  return toolDefinitions.find((tool) => tool.name === canonical);
}
