CREATE TABLE connector_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('apple_health', 'garmin', 'strava', 'oura', 'whoop', 'manual')),
  external_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, external_account_id)
);

CREATE INDEX connector_accounts_user_provider_idx ON connector_accounts(user_id, provider);

CREATE TABLE raw_provider_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_account_id TEXT REFERENCES connector_accounts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple_health', 'garmin', 'strava', 'oura', 'whoop', 'manual')),
  type TEXT NOT NULL CHECK (type IN ('activity', 'sleep', 'readiness', 'body', 'unknown')),
  source_record_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, source_record_id)
);

CREATE INDEX raw_provider_events_user_provider_observed_idx
  ON raw_provider_events(user_id, provider, observed_at DESC);

CREATE TABLE normalized_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_provider_event_id TEXT REFERENCES raw_provider_events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout', 'health_metric')),
  source TEXT NOT NULL CHECK (source IN ('apple_health', 'garmin', 'strava', 'oura', 'whoop', 'manual')),
  source_record_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_record_id, kind)
);

CREATE INDEX normalized_events_user_kind_occurred_idx
  ON normalized_events(user_id, kind, occurred_at DESC);
