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
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  auto_sync INTEGER NOT NULL DEFAULT 0 CHECK(auto_sync IN (0,1)),
  next_sync_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
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
  identity_snapshot TEXT NOT NULL CHECK(json_valid(identity_snapshot)),
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
  mentioned INTEGER NOT NULL CHECK(mentioned IN (0,1)),
  cited INTEGER NOT NULL CHECK(cited IN (0,1)),
  citation_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(citation_urls)),
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
