-- v0.4 additive release. Existing accounts, content, media and source history are retained.
BEGIN;
SET LOCAL ROLE smis_marketing_app;
SET LOCAL search_path TO smis_marketing, pg_catalog;
SELECT pg_advisory_xact_lock(hashtext('smis:smis_marketing:migrations'));

-- Source: server/migrations/004_owner_mcp.sql
INSERT INTO workspace_metadata(key,value)
SELECT 'workspace_owner_id',id FROM users
WHERE role='manager' AND active=1 ORDER BY created_at,id LIMIT 1
ON CONFLICT(key) DO NOTHING;

CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL CHECK ((metadata_json)::jsonb IS NOT NULL),
  encrypted_secret TEXT,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE TABLE mcp_authorization_requests (
  request_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL CHECK ((scopes)::jsonb IS NOT NULL),
  resource TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE TABLE mcp_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL CHECK ((scopes)::jsonb IS NOT NULL),
  resource TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);
CREATE INDEX mcp_grants_user ON mcp_grants(user_id,revoked_at);
CREATE TABLE mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);
CREATE TABLE mcp_write_receipts (
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK ((result_json)::jsonb IS NOT NULL),
  created_at BIGINT NOT NULL,
  PRIMARY KEY(grant_id,idempotency_key)
);
CREATE TABLE mcp_rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count BIGINT NOT NULL
);


-- Source: server/intelligence/migration-v2.sql
-- Additive upgrade: existing feed watches, notices and evidence are preserved.
CREATE TABLE IF NOT EXISTS intelligence_page_monitors (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL UNIQUE REFERENCES competitors(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  interval_hours BIGINT NOT NULL DEFAULT 24 CHECK (interval_hours >= 6 AND interval_hours <= 168),
  active BIGINT NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_checked_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT NOT NULL,
  last_error TEXT,
  failures BIGINT NOT NULL DEFAULT 0,
  run_token TEXT,
  lease_until TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_page_monitors_due ON intelligence_page_monitors(active, next_check_at);

CREATE TABLE IF NOT EXISTS intelligence_page_snapshots (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES intelligence_page_monitors(id) ON DELETE CASCADE,
  generation BIGINT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  comparison TEXT NOT NULL CHECK ((comparison)::jsonb IS NOT NULL),
  baseline BIGINT NOT NULL CHECK (baseline IN (0, 1)),
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_page_snapshots_recent ON intelligence_page_snapshots(monitor_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_research_requests (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('competitor', 'exam')),
  target_id TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  observed_at TEXT,
  result_summary TEXT NOT NULL DEFAULT '',
  evidence_urls TEXT NOT NULL DEFAULT '[]' CHECK ((evidence_urls)::jsonb IS NOT NULL),
  result_hash TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_research_pending ON intelligence_research_requests(target_type, target_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS intelligence_research_requested ON intelligence_research_requests(requested_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_competitor_observations (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_urls TEXT NOT NULL CHECK ((evidence_urls)::jsonb IS NOT NULL),
  metrics TEXT NOT NULL DEFAULT '{}' CHECK ((metrics)::jsonb IS NOT NULL),
  recent_items TEXT NOT NULL DEFAULT '[]' CHECK ((recent_items)::jsonb IS NOT NULL),
  comparison TEXT NOT NULL CHECK ((comparison)::jsonb IS NOT NULL),
  content_hash TEXT NOT NULL,
  idempotency_key TEXT,
  request_id TEXT REFERENCES intelligence_research_requests(id) ON DELETE SET NULL,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (competitor_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS intelligence_competitor_observations_recent ON intelligence_competitor_observations(competitor_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_exams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Entrance', 'Board', 'Counselling', 'Scholarship', 'Recruitment', 'Other')),
  streams TEXT NOT NULL CHECK ((streams)::jsonb IS NOT NULL),
  description TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  eligibility_notes TEXT NOT NULL DEFAULT '',
  reference_links TEXT NOT NULL CHECK ((reference_links)::jsonb IS NOT NULL),
  milestones TEXT NOT NULL DEFAULT '[]' CHECK ((milestones)::jsonb IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'tracking', 'archived')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_exams_name ON intelligence_exams(name);

CREATE TABLE IF NOT EXISTS intelligence_exam_watches (
  exam_id TEXT NOT NULL REFERENCES intelligence_exams(id) ON DELETE CASCADE,
  watch_id TEXT NOT NULL REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, watch_id)
);

CREATE TABLE IF NOT EXISTS intelligence_career_pathways (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('Science', 'Commerce', 'Humanities', 'Vocational', 'Any')),
  field TEXT NOT NULL,
  description TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  eligibility_notes TEXT NOT NULL DEFAULT '',
  entry_routes TEXT NOT NULL DEFAULT '[]' CHECK ((entry_routes)::jsonb IS NOT NULL),
  reference_links TEXT NOT NULL CHECK ((reference_links)::jsonb IS NOT NULL),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_career_pathways_stream ON intelligence_career_pathways(stream, field);

INSERT INTO workspace_metadata(key, value) VALUES ('intelligence_schema_version', '2')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;


-- Source: server/intelligence/migration-v3.sql
CREATE TABLE IF NOT EXISTS intelligence_youtube_subscriptions (
  watch_id TEXT PRIMARY KEY REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  callback_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  enabled BIGINT NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('disabled','pending','active','needs_attention')),
  requested_mode TEXT CHECK(requested_mode IN ('subscribe','unsubscribe')),
  request_token TEXT,
  verified_token TEXT,
  pending_until TEXT,
  lease_expires_at TEXT,
  renew_after TEXT,
  last_attempt_at TEXT,
  last_delivery_at TEXT,
  last_error TEXT,
  failures BIGINT NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_youtube_renew ON intelligence_youtube_subscriptions(renew_after,enabled);

CREATE TABLE IF NOT EXISTS intelligence_youtube_push_receipts (
  watch_id TEXT NOT NULL REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(watch_id,payload_hash)
);
CREATE INDEX IF NOT EXISTS intelligence_youtube_receipt_age ON intelligence_youtube_push_receipts(watch_id,received_at);

CREATE TABLE IF NOT EXISTS intelligence_youtube_push_items (
  watch_id TEXT NOT NULL REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY(watch_id,item_key)
);

INSERT INTO workspace_metadata(key,value) VALUES('intelligence_schema_version','3')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;

INSERT INTO workspace_metadata(key,value) VALUES('intelligence_extensions_version','3')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;


-- Source: server/rankings/schema.sql
CREATE TABLE IF NOT EXISTS ranking_keywords (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  keyword TEXT NOT NULL,
  institution TEXT NOT NULL,
  connection_id TEXT REFERENCES service_connections(id) ON DELETE SET NULL,
  property_id TEXT NOT NULL DEFAULT '',
  property_name TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT 'all' CHECK(device IN ('all','DESKTOP','MOBILE','TABLET')),
  search_type TEXT NOT NULL DEFAULT 'web' CHECK(search_type IN ('web','image','video','news')),
  page_url TEXT NOT NULL DEFAULT '',
  answer_prompt TEXT NOT NULL,
  answer_target_url TEXT NOT NULL DEFAULT '',
  answer_locale TEXT NOT NULL,
  answer_language TEXT NOT NULL,
  active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  auto_sync BIGINT NOT NULL DEFAULT 0 CHECK(auto_sync IN (0,1)),
  next_sync_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  failures BIGINT NOT NULL DEFAULT 0,
  run_token TEXT,
  lease_until TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ranking_keywords_due ON ranking_keywords(active,auto_sync,next_sync_at);

-- Only the authorized Search Console adapter can write this table. Absence of
-- a query row is stored as NULL metrics, never as position zero or a lost rank.
CREATE TABLE IF NOT EXISTS ranking_search_samples (
  keyword_id TEXT NOT NULL REFERENCES ranking_keywords(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  position DOUBLE PRECISION,
  clicks DOUBLE PRECISION,
  impressions DOUBLE PRECISION,
  ctr DOUBLE PRECISION,
  availability TEXT NOT NULL CHECK(availability IN ('reported','no_row')),
  imported_at TEXT NOT NULL,
  PRIMARY KEY(keyword_id,date),
  CHECK((availability='reported' AND position >= 1 AND impressions > 0 AND clicks >= 0 AND ctr >= 0 AND ctr <= 1)
    OR (availability='no_row' AND position IS NULL AND clicks IS NULL AND impressions IS NULL AND ctr IS NULL))
);

-- Team/MCP observations are deliberately separate from verified API imports.
CREATE TABLE IF NOT EXISTS ranking_search_evidence (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  keyword_id TEXT NOT NULL REFERENCES ranking_keywords(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL CHECK(position >= 1),
  clicks DOUBLE PRECISION CHECK(clicks >= 0),
  impressions DOUBLE PRECISION CHECK(impressions >= 0),
  provenance TEXT NOT NULL CHECK(provenance IN ('manual','mcp')),
  evidence_url TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  identity_snapshot TEXT NOT NULL CHECK ((identity_snapshot)::jsonb IS NOT NULL),
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ranking_search_evidence_dates ON ranking_search_evidence(keyword_id,date,created_at);

-- Changing a prompt, model, locale or target creates a separate answer series.
CREATE TABLE IF NOT EXISTS ranking_answer_contexts (
  id TEXT PRIMARY KEY,
  keyword_id TEXT NOT NULL REFERENCES ranking_keywords(id) ON DELETE CASCADE,
  context_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  target_url TEXT NOT NULL,
  locale TEXT NOT NULL,
  language TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(keyword_id,context_key)
);
CREATE TABLE IF NOT EXISTS ranking_answer_observations (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  context_id TEXT NOT NULL REFERENCES ranking_answer_contexts(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  observation_date TEXT NOT NULL,
  mentioned BIGINT NOT NULL CHECK(mentioned IN (0,1)),
  cited BIGINT NOT NULL CHECK(cited IN (0,1)),
  citation_urls TEXT NOT NULL DEFAULT '[]' CHECK ((citation_urls)::jsonb IS NOT NULL),
  answer_excerpt TEXT NOT NULL,
  evidence_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  provenance TEXT NOT NULL CHECK(provenance IN ('manual','mcp')),
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ranking_answer_observations_dates ON ranking_answer_observations(context_id,observation_date);

INSERT INTO workspace_metadata(key,value) VALUES('rankings_schema_version','1')
ON CONFLICT(key) DO UPDATE SET value=excluded.value;


-- Keep the v0.3 application valid during deployment/rollback. v0.4 reads the additive marker.
UPDATE workspace_metadata SET value='1' WHERE key='intelligence_schema_version';
INSERT INTO schema_migrations(version,name,applied_at) VALUES(4,'004_owner_mcp.sql',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
COMMIT;
