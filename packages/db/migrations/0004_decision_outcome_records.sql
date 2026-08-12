CREATE TABLE decision_records (
  decision_id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  evidence_source TEXT NOT NULL,
  tool TEXT,
  trace JSONB NOT NULL
);

CREATE TABLE outcome_records (
  outcome_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  user_id TEXT,
  decision_id TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  outcome JSONB NOT NULL
);

CREATE INDEX decision_records_user_created_idx ON decision_records(user_id, created_at DESC);
CREATE INDEX outcome_records_case_recorded_idx ON outcome_records(case_id, recorded_at ASC);
