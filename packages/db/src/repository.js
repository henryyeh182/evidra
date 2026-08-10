// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  mapPlanToRow,
  mapPlannedWorkoutToRow,
  mapSemanticStateToRow,
  mapUserContextToRows
} from "./mappers.js";

const SQLITE_SCHEMA = readFileSync(new URL("../schema/sqlite.sql", import.meta.url), "utf8");

function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

function nullable(value) {
  return value === undefined ? null : value;
}

function contextFromRows(user, rows) {
  return {
    user: {
      id: user.id,
      name: user.name,
      timezone: user.timezone,
      heightCm: user.height_cm,
      weightKg: user.weight_kg,
      fitnessLevel: user.fitness_level
    },
    goals: rows.goals.map((row) => ({
      id: row.id,
      type: row.type,
      label: row.label,
      priority: row.priority,
      targetDate: row.target_date || undefined,
      status: row.status
    })),
    preferences: rows.preferences.map((row) => ({
      id: row.id,
      category: row.category,
      key: row.key,
      value: json(row.value_json, null),
      strength: row.strength
    })),
    injuries: rows.injuries.map((row) => ({
      id: row.id,
      bodyRegion: row.body_region,
      severity: row.severity,
      restrictions: json(row.restrictions_json, []),
      status: row.status
    })),
    equipment: rows.equipment.map((row) => ({
      id: row.id,
      type: row.type,
      location: row.location,
      available: Boolean(row.available)
    })),
    workouts: rows.workouts.map((row) => ({
      id: row.id,
      type: row.type,
      name: row.name,
      startedAt: row.started_at,
      durationMinutes: row.duration_minutes,
      rpe: nullable(row.rpe),
      trainingLoad: nullable(row.training_load),
      muscleGroups: json(row.muscle_groups_json, []),
      source: row.source,
      sourceRecordId: row.source_record_id || undefined
    })),
    healthMetrics: rows.healthMetrics.map((row) => ({
      id: row.id,
      type: row.type,
      value: row.value,
      unit: row.unit,
      recordedAt: row.recorded_at,
      source: row.source,
      sourceRecordId: row.source_record_id || undefined,
      confidence: row.confidence,
      ...(row.basis ? { basis: row.basis } : {})
    }))
  };
}

function planFromRows(planRow, workoutRows) {
  const weeks = new Map();
  for (const row of workoutRows) {
    if (!weeks.has(row.week_index)) {
      weeks.set(row.week_index, {
        weekIndex: row.week_index,
        phase: row.phase || "base",
        startDate: row.week_start_date || row.workout_date,
        loadMultiplier: row.load_multiplier ?? 1,
        sessions: []
      });
    }
    weeks.get(row.week_index).sessions.push({
      id: row.id,
      dayOfWeek: row.day_of_week,
      date: row.workout_date,
      focus: row.focus,
      type: row.type,
      durationMinutes: row.duration_minutes,
      intensity: row.intensity,
      targetMuscleGroups: json(row.target_muscle_groups_json, []),
      exerciseIds: json(row.exercise_ids_json, []),
      exercises: json(row.exercises_json, []),
      rationale: row.rationale
    });
  }

  return {
    id: planRow.id,
    userId: planRow.user_id,
    goalId: planRow.goal_id,
    name: planRow.name,
    startDate: planRow.start_date,
    endDate: planRow.end_date,
    periodizationType: planRow.periodization_type,
    status: planRow.status,
    version: planRow.version,
    constraints: json(planRow.constraints_json, {}),
    weeks: [...weeks.values()].sort((a, b) => a.weekIndex - b.weekIndex),
    reasoning: json(planRow.reasoning_json, []),
    decisionBasis: json(planRow.decision_basis_json, null),
    createdAt: planRow.created_at
  };
}

/** Interface for persistence adapters used by a private engine. */
export class FitnessRepository {
  async getUserContext(_userId) {
    throw new Error("FitnessRepository.getUserContext must be implemented.");
  }

  async saveUserContext(_context) {
    throw new Error("FitnessRepository.saveUserContext must be implemented.");
  }

  async getSemanticFitnessState(_userId, _date) {
    throw new Error("FitnessRepository.getSemanticFitnessState must be implemented.");
  }

  async saveSemanticFitnessState(_state) {
    throw new Error("FitnessRepository.saveSemanticFitnessState must be implemented.");
  }

  async savePlan(_plan) {
    throw new Error("FitnessRepository.savePlan must be implemented.");
  }

  async getPlan(_planId, _userId) {
    throw new Error("FitnessRepository.getPlan must be implemented.");
  }

  async listPlans(_userId) {
    throw new Error("FitnessRepository.listPlans must be implemented.");
  }

  async getPlannedWorkoutForDate(_userId, _date) {
    throw new Error("FitnessRepository.getPlannedWorkoutForDate must be implemented.");
  }
}

/**
 * SQLite-first repository for the user-controlled private engine.
 *
 * It deliberately uses Node's local SQLite implementation rather than adding a
 * hosted database dependency. The database file is supplied by the operator;
 * `:memory:` is useful for tests and import previews.
 */
export class SQLiteFitnessRepository extends FitnessRepository {
  constructor({ filename = ":memory:", database } = {}) {
    super();
    this.db = database || new DatabaseSync(filename);
    this.db.exec(SQLITE_SCHEMA);
  }

  close() {
    this.db.close();
  }

  async saveUserContext(context) {
    const rows = mapUserContextToRows(context);
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO users (id, name, timezone, height_cm, weight_kg, fitness_level)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, timezone=excluded.timezone,
          height_cm=excluded.height_cm, weight_kg=excluded.weight_kg,
          fitness_level=excluded.fitness_level, updated_at=CURRENT_TIMESTAMP
      `).run(
        rows.users[0].id, rows.users[0].name, rows.users[0].timezone,
        rows.users[0].height_cm, rows.users[0].weight_kg, rows.users[0].fitness_level
      );

      for (const table of ["goals", "preferences", "injuries", "equipment", "workouts", "health_metrics"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(context.user.id);
      }

      const insertGoal = this.db.prepare("INSERT INTO goals (id, user_id, type, label, priority, target_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const row of rows.goals) insertGoal.run(row.id, row.user_id, row.type, row.label, row.priority, row.target_date, row.status);

      const insertPreference = this.db.prepare("INSERT INTO preferences (id, user_id, category, key, value_json, strength) VALUES (?, ?, ?, ?, ?, ?)");
      for (const row of rows.preferences) insertPreference.run(row.id, row.user_id, row.category, row.key, JSON.stringify(row.value), row.strength);

      const insertInjury = this.db.prepare("INSERT INTO injuries (id, user_id, body_region, severity, restrictions_json, status) VALUES (?, ?, ?, ?, ?, ?)");
      for (const row of rows.injuries) insertInjury.run(row.id, row.user_id, row.body_region, row.severity, JSON.stringify(row.restrictions), row.status);

      const insertEquipment = this.db.prepare("INSERT INTO equipment (id, user_id, type, location, available) VALUES (?, ?, ?, ?, ?)");
      for (const row of rows.equipment) insertEquipment.run(row.id, row.user_id, row.type, row.location, row.available ? 1 : 0);

      const insertWorkout = this.db.prepare("INSERT INTO workouts (id, user_id, type, name, started_at, duration_minutes, rpe, training_load, muscle_groups_json, source, source_record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of rows.workouts) insertWorkout.run(
        row.id, row.user_id, row.type, row.name, row.started_at, row.duration_minutes,
        nullable(row.rpe), nullable(row.training_load), JSON.stringify(row.muscle_groups || []),
        row.source, row.source_record_id
      );

      const insertMetric = this.db.prepare("INSERT INTO health_metrics (id, user_id, type, value, unit, recorded_at, source, source_record_id, confidence, basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const row of rows.health_metrics) insertMetric.run(
        row.id, row.user_id, row.type, row.value, row.unit || "", row.recorded_at,
        row.source, row.source_record_id, row.confidence ?? 1, null
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return context.user.id;
  }

  async getUserContext(userId) {
    const user = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) return null;
    const rows = {
      goals: this.db.prepare("SELECT * FROM goals WHERE user_id = ? ORDER BY priority, id").all(userId),
      preferences: this.db.prepare("SELECT * FROM preferences WHERE user_id = ? ORDER BY category, key").all(userId),
      injuries: this.db.prepare("SELECT * FROM injuries WHERE user_id = ? ORDER BY id").all(userId),
      equipment: this.db.prepare("SELECT * FROM equipment WHERE user_id = ? ORDER BY type, location").all(userId),
      workouts: this.db.prepare("SELECT * FROM workouts WHERE user_id = ? ORDER BY started_at").all(userId),
      healthMetrics: this.db.prepare("SELECT * FROM health_metrics WHERE user_id = ? ORDER BY recorded_at").all(userId)
    };
    return contextFromRows(user, rows);
  }

  async saveSemanticFitnessState(state) {
    const row = mapSemanticStateToRow(state);
    this.db.prepare(`
      INSERT INTO semantic_fitness_states
        (id, user_id, state_date, timezone, recovery_score, readiness_score, fatigue_score,
         sleep_quality, training_load_7d, training_load_28d, acute_chronic_workload_ratio,
         muscle_fatigue_json, recommended_focus, avoid_json, available_time_minutes,
         goal_alignment_json, confidence, reasoning_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, state_date) DO UPDATE SET
        id=excluded.id, timezone=excluded.timezone, recovery_score=excluded.recovery_score,
        readiness_score=excluded.readiness_score, fatigue_score=excluded.fatigue_score,
        sleep_quality=excluded.sleep_quality, training_load_7d=excluded.training_load_7d,
        training_load_28d=excluded.training_load_28d,
        acute_chronic_workload_ratio=excluded.acute_chronic_workload_ratio,
        muscle_fatigue_json=excluded.muscle_fatigue_json, recommended_focus=excluded.recommended_focus,
        avoid_json=excluded.avoid_json, available_time_minutes=excluded.available_time_minutes,
        goal_alignment_json=excluded.goal_alignment_json, confidence=excluded.confidence,
        reasoning_json=excluded.reasoning_json, generated_at=CURRENT_TIMESTAMP
    `).run(
      row.id, row.user_id, row.state_date, row.timezone, row.recovery_score,
      nullable(row.readiness_score), row.fatigue_score, nullable(row.sleep_quality), row.training_load_7d,
      row.training_load_28d, row.acute_chronic_workload_ratio, JSON.stringify(row.muscle_fatigue),
      row.recommended_focus, JSON.stringify(row.avoid), row.available_time_minutes,
      JSON.stringify(row.goal_alignment), row.confidence, JSON.stringify(row.reasoning)
    );
    return state;
  }

  async getSemanticFitnessState(userId, date) {
    const row = this.db.prepare("SELECT * FROM semantic_fitness_states WHERE user_id = ? AND state_date = ?").get(userId, date);
    if (!row) return null;
    return {
      userId: row.user_id,
      date: row.state_date,
      timezone: row.timezone,
      recoveryScore: row.recovery_score,
      readinessScore: row.readiness_score,
      fatigueScore: row.fatigue_score,
      sleepQuality: row.sleep_quality,
      trainingLoad7d: row.training_load_7d,
      trainingLoad28d: row.training_load_28d,
      acuteChronicWorkloadRatio: row.acute_chronic_workload_ratio,
      muscleFatigue: json(row.muscle_fatigue_json, {}),
      recommendedFocus: row.recommended_focus,
      avoid: json(row.avoid_json, []),
      availableTimeMinutes: row.available_time_minutes,
      goalAlignment: json(row.goal_alignment_json, {}),
      confidence: row.confidence,
      reasoning: json(row.reasoning_json, [])
    };
  }

  async savePlan(plan) {
    const row = mapPlanToRow(plan);
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO plans
          (id, user_id, goal_id, name, start_date, end_date, periodization_type, status,
           version, constraints_json, reasoning_json, decision_basis_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, goal_id=excluded.goal_id,
          name=excluded.name, start_date=excluded.start_date, end_date=excluded.end_date,
          periodization_type=excluded.periodization_type, status=excluded.status,
          version=excluded.version, constraints_json=excluded.constraints_json,
          reasoning_json=excluded.reasoning_json, decision_basis_json=excluded.decision_basis_json,
          updated_at=CURRENT_TIMESTAMP
      `).run(
        row.id, row.user_id, row.goal_id, row.name, row.start_date, row.end_date,
        row.periodization_type, row.status, row.version, JSON.stringify(row.constraints),
        JSON.stringify(row.reasoning), row.decision_basis ? JSON.stringify(row.decision_basis) : null,
        row.created_at
      );

      this.db.prepare("DELETE FROM planned_workouts WHERE plan_id = ?").run(plan.id);
      const insertWorkout = this.db.prepare(`
        INSERT INTO planned_workouts
          (id, plan_id, user_id, week_index, phase, week_start_date, load_multiplier,
           day_of_week, workout_date, focus, type,
           duration_minutes, intensity, target_muscle_groups_json, exercise_ids_json,
           exercises_json, rationale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const week of plan.weeks || []) {
        for (const workout of week.sessions || []) {
          const session = mapPlannedWorkoutToRow(plan, week, workout);
          insertWorkout.run(
            session.id, session.plan_id, session.user_id, session.week_index,
            session.phase, session.week_start_date, session.load_multiplier,
            session.day_of_week, session.workout_date, session.focus, session.type,
            session.duration_minutes, session.intensity, JSON.stringify(session.target_muscle_groups),
            JSON.stringify(session.exercise_ids), JSON.stringify(session.exercises), session.rationale
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return plan;
  }

  async getPlan(planId, userId) {
    const row = this.db.prepare(
      `SELECT * FROM plans WHERE id = ?${userId ? " AND user_id = ?" : ""}`
    ).get(...(userId ? [planId, userId] : [planId]));
    if (!row) return null;
    const workouts = this.db.prepare("SELECT * FROM planned_workouts WHERE plan_id = ? ORDER BY week_index, workout_date, id").all(planId);
    return planFromRows(row, workouts);
  }

  async listPlans(userId) {
    const rows = this.db.prepare("SELECT * FROM plans WHERE user_id = ? ORDER BY start_date DESC, id").all(userId);
    return Promise.all(rows.map((row) => this.getPlan(row.id, userId)));
  }

  async getPlannedWorkoutForDate(userId, date) {
    const row = this.db.prepare(`
      SELECT p.id AS plan_id, p.version AS plan_version, w.*
      FROM planned_workouts w
      JOIN plans p ON p.id = w.plan_id
      WHERE w.user_id = ? AND w.workout_date = ? AND p.status <> 'archived'
      ORDER BY p.start_date DESC, p.version DESC, w.id
      LIMIT 1
    `).get(userId, date);
    if (!row) return null;
    return {
      planId: row.plan_id,
      planVersion: row.plan_version,
      id: row.id,
      dayOfWeek: row.day_of_week,
      date: row.workout_date,
      focus: row.focus,
      type: row.type,
      durationMinutes: row.duration_minutes,
      intensity: row.intensity,
      targetMuscleGroups: json(row.target_muscle_groups_json, []),
      exerciseIds: json(row.exercise_ids_json, []),
      exercises: json(row.exercises_json, []),
      rationale: row.rationale
    };
  }
}
