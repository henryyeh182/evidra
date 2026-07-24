export const toolDefinitions = [
  {
    name: "get_semantic_fitness_state",
    description: "Return the user's computed Semantic Fitness State for a date.",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "User identifier."
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today's demo date."
        }
      },
      required: ["userId"]
    }
  },
  {
    name: "recommend_workout",
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
          description: "Date in YYYY-MM-DD format. Defaults to today's demo date."
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
    name: "get_training_context",
    description: "Return normalized profile, goals, workouts, health metric counts, and available tools context.",
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
    description: "Generate and store a deterministic periodized multi-week training plan from the user's goals and constraints.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User identifier." },
        goalId: { type: "string", description: "Goal to build the plan around. Defaults to the highest-priority goal." },
        weeks: { type: "number", description: "Number of weeks to plan. Defaults to 4." },
        startDate: { type: "string", description: "Plan start date in YYYY-MM-DD format (ideally a Monday)." }
      },
      required: ["userId"]
    }
  },
  {
    name: "get_plan",
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

export function getToolDefinition(name) {
  const canonical = resolveToolName(name);
  return toolDefinitions.find((tool) => tool.name === canonical);
}
