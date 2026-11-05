CREATE TABLE IF NOT EXISTS intelligence_watches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source', 'competitor')),
  source_id TEXT UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  competitor_id TEXT UNIQUE REFERENCES competitors(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('rss', 'html', 'youtube')),
  url TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(keywords)),
  interval_hours INTEGER NOT NULL DEFAULT 12 CHECK (interval_hours >= 6 AND interval_hours <= 168),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_checked_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT NOT NULL,
  last_new_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  run_token TEXT,
  lease_until TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'source' AND source_id IS NOT NULL AND competitor_id IS NULL) OR
         (kind = 'competitor' AND competitor_id IS NOT NULL AND source_id IS NULL))
);
CREATE INDEX IF NOT EXISTS intelligence_watches_due ON intelligence_watches(active, next_check_at);

CREATE TABLE IF NOT EXISTS intelligence_notices (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  detected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('discovered', 'updated')),
  baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'dismissed')),
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE SET NULL,
  UNIQUE (watch_id, item_key)
);
CREATE INDEX IF NOT EXISTS intelligence_notices_updated ON intelligence_notices(updated_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_notice_history (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL REFERENCES intelligence_notices(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (notice_id, content_hash)
);

CREATE TABLE IF NOT EXISTS intelligence_sites (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL UNIQUE,
  verification_token TEXT NOT NULL,
  verified_at TEXT,
  last_verify_attempt_at TEXT,
  last_audit_at TEXT,
  last_audit_attempt_at TEXT,
  run_token TEXT,
  lease_until TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_seo_audits (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES intelligence_sites(id) ON DELETE CASCADE,
  report TEXT NOT NULL CHECK (json_valid(report)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_seo_audits_created ON intelligence_seo_audits(created_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_answer_prompts (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  intent TEXT NOT NULL,
  institution TEXT NOT NULL,
  locale TEXT NOT NULL,
  language TEXT NOT NULL,
  target_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intelligence_answer_observations (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL REFERENCES intelligence_answer_prompts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  answer_excerpt TEXT NOT NULL,
  mentioned INTEGER NOT NULL CHECK (mentioned IN (0, 1)),
  cited INTEGER NOT NULL CHECK (cited IN (0, 1)),
  citation_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(citation_urls)),
  evidence_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  prompt_snapshot TEXT NOT NULL CHECK (json_valid(prompt_snapshot)),
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_answer_observations_checked ON intelligence_answer_observations(checked_at DESC);

INSERT INTO workspace_metadata(key, value) VALUES ('intelligence_schema_version', '1')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
