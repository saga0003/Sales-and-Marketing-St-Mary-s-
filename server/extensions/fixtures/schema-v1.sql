CREATE TABLE IF NOT EXISTS provider_settings (
  provider TEXT PRIMARY KEY,
  encrypted_credentials TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google','instagram')),
  account_id TEXT,
  account_name TEXT NOT NULL,
  institution TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_selection','connected','needs_attention','disconnected')),
  capabilities TEXT NOT NULL DEFAULT '[]',
  encrypted_credentials TEXT,
  connected_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_test_at TEXT,
  last_sync_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS oauth_authorizations (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_hash TEXT NOT NULL,
  institution TEXT NOT NULL,
  encrypted_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  storage_kind TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  storage_url TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS website_reports (
  connection_id TEXT PRIMARY KEY REFERENCES service_connections(id),
  report_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_jobs (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  revision INTEGER NOT NULL,
  connection_id TEXT NOT NULL REFERENCES service_connections(id),
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES media_assets(id),
  approved_payload TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','published','failed','needs_reconciliation','cancelled')),
  scheduled_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  lease_expires_at TEXT,
  container_id TEXT,
  publish_started_at TEXT,
  remote_id TEXT,
  remote_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(post_id, revision, connection_id)
);
CREATE INDEX IF NOT EXISTS publication_jobs_due ON publication_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS publication_jobs_post ON publication_jobs(post_id, status);
CREATE INDEX IF NOT EXISTS service_connections_institution ON service_connections(institution, status);
CREATE UNIQUE INDEX IF NOT EXISTS service_connections_unique_account ON service_connections(provider, account_id)
  WHERE account_id IS NOT NULL AND status <> 'disconnected';

INSERT INTO workspace_metadata(key, value) VALUES ('provider_extensions_schema_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
