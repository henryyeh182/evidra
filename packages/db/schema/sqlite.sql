PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  height_cm REAL NOT NULL,
  weight_kg REAL NOT NULL,
  fitness_level TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  priority INTEGER NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  strength REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, category, key)
);

CREATE TABLE IF NOT EXISTS injuries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_region TEXT NOT NULL,
  severity TEXT NOT NULL,
  restrictions_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  location TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, type, location)
);

CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  rpe REAL,
  training_load REAL,
  muscle_groups_json TEXT NOT NULL,
  source TEXT NOT NULL,
  source_record_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS health_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_record_id TEXT,
  confidence REAL NOT NULL DEFAULT 1,
  basis TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semantic_fitness_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  recovery_score INTEGER NOT NULL,
  readiness_score INTEGER,
  fatigue_score INTEGER NOT NULL,
  sleep_quality INTEGER,
  training_load_7d REAL NOT NULL,
  training_load_28d REAL NOT NULL,
  acute_chronic_workload_ratio REAL NOT NULL,
  muscle_fatigue_json TEXT NOT NULL,
  recommended_focus TEXT NOT NULL,
  avoid_json TEXT NOT NULL,
  available_time_minutes INTEGER NOT NULL,
  goal_alignment_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reasoning_json TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, state_date)
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  periodization_type TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  version INTEGER NOT NULL DEFAULT 1,
  constraints_json TEXT NOT NULL,
  reasoning_json TEXT NOT NULL,
  decision_basis_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planned_workouts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_index INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'base',
  week_start_date TEXT NOT NULL,
  load_multiplier REAL NOT NULL DEFAULT 1,
  day_of_week TEXT NOT NULL,
  workout_date TEXT NOT NULL,
  focus TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  intensity TEXT NOT NULL,
  target_muscle_groups_json TEXT NOT NULL,
  exercise_ids_json TEXT NOT NULL,
  exercises_json TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (plan_id, id)
);

CREATE TABLE IF NOT EXISTS decision_records (
  decision_id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  tool TEXT,
  trace_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcome_records (
  outcome_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  user_id TEXT,
  decision_id TEXT,
  recorded_at TEXT NOT NULL,
  outcome_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS goals_user_priority_idx ON goals(user_id, priority);
CREATE INDEX IF NOT EXISTS workouts_user_started_idx ON workouts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS health_metrics_user_type_recorded_idx ON health_metrics(user_id, type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS semantic_states_user_date_idx ON semantic_fitness_states(user_id, state_date DESC);
CREATE INDEX IF NOT EXISTS plans_user_start_date_idx ON plans(user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS planned_workouts_user_date_idx ON planned_workouts(user_id, workout_date);
CREATE INDEX IF NOT EXISTS decision_records_user_created_idx ON decision_records(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS outcome_records_case_recorded_idx ON outcome_records(case_id, recorded_at ASC);
