CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  periodization_type TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'modified', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasoning JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_basis JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX plans_user_start_date_idx ON plans(user_id, start_date DESC);

CREATE TABLE planned_workouts (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_index INTEGER NOT NULL CHECK (week_index >= 0),
  phase TEXT NOT NULL DEFAULT 'base',
  week_start_date DATE NOT NULL,
  load_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1,
  day_of_week TEXT NOT NULL,
  workout_date DATE NOT NULL,
  focus TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('low', 'moderate', 'high')),
  target_muscle_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  exercise_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, id)
);

CREATE INDEX planned_workouts_user_date_idx ON planned_workouts(user_id, workout_date);
CREATE INDEX planned_workouts_plan_week_idx ON planned_workouts(plan_id, week_index, workout_date);
