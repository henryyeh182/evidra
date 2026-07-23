CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  height_cm NUMERIC(6, 2) NOT NULL CHECK (height_cm > 0),
  weight_kg NUMERIC(6, 2) NOT NULL CHECK (weight_kg > 0),
  fitness_level TEXT NOT NULL CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('lose_fat', 'build_muscle', 'half_marathon', 'general_fitness', 'recovery')),
  label TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority > 0),
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX goals_user_id_priority_idx ON goals(user_id, priority);

CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  strength NUMERIC(3, 2) NOT NULL CHECK (strength >= 0 AND strength <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, key)
);

CREATE TABLE injuries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_region TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'moderate', 'high')),
  restrictions JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX injuries_user_id_status_idx ON injuries(user_id, status);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  location TEXT NOT NULL,
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, location)
);

CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('strength', 'run', 'ride', 'mobility', 'recovery', 'walk')),
  name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  rpe NUMERIC(3, 1) NOT NULL CHECK (rpe >= 1 AND rpe <= 10),
  training_load NUMERIC(8, 2) NOT NULL CHECK (training_load >= 0),
  muscle_groups JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('apple_health', 'garmin', 'strava', 'oura', 'whoop', 'manual')),
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workouts_user_id_started_at_idx ON workouts(user_id, started_at DESC);
CREATE INDEX workouts_source_record_idx ON workouts(source, source_record_id);

CREATE TABLE health_metrics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN ('sleep_duration_hours', 'sleep_quality', 'hrv_ms', 'resting_hr_bpm', 'steps', 'stress')
  ),
  value NUMERIC(12, 4) NOT NULL,
  unit TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('apple_health', 'garmin', 'strava', 'oura', 'whoop', 'manual')),
  source_record_id TEXT,
  confidence NUMERIC(3, 2) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX health_metrics_user_type_recorded_idx ON health_metrics(user_id, type, recorded_at DESC);
CREATE INDEX health_metrics_source_record_idx ON health_metrics(source, source_record_id);

CREATE TABLE semantic_fitness_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_date DATE NOT NULL,
  timezone TEXT NOT NULL,
  recovery_score INTEGER NOT NULL CHECK (recovery_score >= 0 AND recovery_score <= 100),
  readiness_score INTEGER NOT NULL CHECK (readiness_score >= 0 AND readiness_score <= 100),
  fatigue_score INTEGER NOT NULL CHECK (fatigue_score >= 0 AND fatigue_score <= 100),
  sleep_quality INTEGER NOT NULL CHECK (sleep_quality >= 0 AND sleep_quality <= 100),
  training_load_7d NUMERIC(10, 2) NOT NULL,
  training_load_28d NUMERIC(10, 2) NOT NULL,
  acute_chronic_workload_ratio NUMERIC(6, 2) NOT NULL,
  muscle_fatigue JSONB NOT NULL,
  recommended_focus TEXT NOT NULL,
  avoid JSONB NOT NULL,
  available_time_minutes INTEGER NOT NULL,
  goal_alignment JSONB NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  reasoning JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, state_date)
);

CREATE INDEX semantic_states_user_date_idx ON semantic_fitness_states(user_id, state_date DESC);
