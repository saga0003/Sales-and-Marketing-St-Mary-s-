-- Run in the application's private schema in one migration transaction.
-- Existing connections, credentials, assets and approved jobs are retained.
ALTER TABLE service_connections DROP CONSTRAINT IF EXISTS service_connections_provider_check;
ALTER TABLE service_connections ADD CONSTRAINT service_connections_provider_check
  CHECK (provider IN ('google','instagram','search_console','youtube','google_business','google_ads','facebook','linkedin','linkedin_member','meta_ads'));
ALTER TABLE service_connections ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0 CHECK(auto_sync IN (0,1));
ALTER TABLE service_connections ADD COLUMN sync_interval_hours INTEGER NOT NULL DEFAULT 24 CHECK(sync_interval_hours BETWEEN 6 AND 168);
ALTER TABLE service_connections ADD COLUMN next_sync_at TEXT;
ALTER TABLE service_connections ADD COLUMN sync_lease_id TEXT;
ALTER TABLE service_connections ADD COLUMN sync_lease_expires_at TEXT;
CREATE INDEX service_connections_report_due ON service_connections(auto_sync, status, next_sync_at);
ALTER TABLE publication_jobs ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE publication_jobs ADD COLUMN remote_visibility TEXT;
ALTER TABLE publication_jobs ADD COLUMN provider_status TEXT;
ALTER TABLE media_assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'image' CHECK(kind IN ('image','video'));
ALTER TABLE media_assets ADD COLUMN duration REAL;
CREATE TABLE platform_reports (
  connection_id TEXT PRIMARY KEY REFERENCES service_connections(id),
  report_json TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
INSERT INTO workspace_metadata(key, value) VALUES ('provider_extensions_schema_version', '2')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
