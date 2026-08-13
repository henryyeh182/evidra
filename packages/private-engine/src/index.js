// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { todayInTimezone } from "../../domain/src/dates.js";
import { generateSemanticFitnessState } from "../../semantic-engine/src/index.js";
import { computeTrainingLoad } from "../../training-load/src/index.js";
import { decideSession } from "../../decision-engine/src/index.js";

const identity = (id) => id;

/**
 * Local data-plane orchestration. The repository is injected so SQLite is the
 * default today while a private Postgres adapter can implement the same
 * FitnessRepository contract later.
 */
export class LocalPrivateEngine {
  constructor({ repository, displayNameFor = identity } = {}) {
    if (!repository) throw new Error("LocalPrivateEngine requires a repository.");
    this.repository = repository;
    this.displayNameFor = displayNameFor;
  }

  /**
   * `context`, when passed, is used in place of a repository read — the path
   * a freshly assembled local evidence import takes (see
   * packages/connectors/src/local/assembleLocalEvidence.js and
   * scripts/import-local-evidence.js). This matters beyond convenience: the
   * repository only persists workouts and health metrics, not
   * vendor_assessment evidence (Garmin's recoveryTime, Body Battery — its
   * most reliable signals), so re-reading via `getUserContext` after a save
   * would silently drop them. Passing the freshly merged in-memory context
   * straight through keeps them in the decision. Either way this never goes
   * through an MCP `evidence` argument — it is read or assembled locally.
   */
  async decideToday({ userId, date, planId, availableMinutes, proposedSession, context: suppliedContext } = {}) {
    if (!userId) throw new Error("LocalPrivateEngine.decideToday requires userId.");
    const context = suppliedContext || (await this.repository.getUserContext(userId));
    if (!context) throw new Error(`No local user context found for ${userId}.`);

    const resolvedDate = date || todayInTimezone(context.user.timezone);
    const storedPlan = planId ? await this.repository.getPlan(planId, userId) : null;
    const storedPlanSession = storedPlan?.weeks
      ?.flatMap((week) => week.sessions || [])
      .find((session) => session.date === resolvedDate);
    const planned = storedPlanSession
      ? { ...storedPlanSession, planId: storedPlan.id, planVersion: storedPlan.version }
      : (planId ? null : await this.repository.getPlannedWorkoutForDate(userId, resolvedDate));

    const state = generateSemanticFitnessState(context, {
      date: resolvedDate,
      timezone: context.user.timezone
    });
    const trainingLoad = computeTrainingLoad(context.workouts, { asOf: resolvedDate });
    const persistedState = { ...state, trainingLoad };
    await this.repository.saveSemanticFitnessState(persistedState);

    const decision = decideSession({
      scheduledSession: planned,
      proposedSession,
      displayNameFor: this.displayNameFor,
      state: trainingLoad.coverage.sufficient
        ? { ...state, acuteChronicWorkloadRatio: trainingLoad.acwr, trainingLoad }
        : { ...state, trainingLoad },
      availableMinutes
    });

    return {
      userId,
      date: resolvedDate,
      planId: planned?.planId || planId || null,
      planVersion: planned?.planVersion || null,
      plannedWorkoutId: planned?.id || null,
      ...decision,
      provenance: {
        deploymentMode: "user-controlled-private",
        repository: "sqlite",
        evidenceSource: suppliedContext ? "local-file-import" : "local-user-context",
        hostedMcp: false
      }
    };
  }
}
