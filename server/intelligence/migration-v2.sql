-- Additive upgrade: existing feed watches, notices and evidence are preserved.
CREATE TABLE IF NOT EXISTS intelligence_page_monitors (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL UNIQUE REFERENCES competitors(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours >= 6 AND interval_hours <= 168),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_checked_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT NOT NULL,
  last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
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
  generation INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  comparison TEXT NOT NULL CHECK (json_valid(comparison)),
  baseline INTEGER NOT NULL CHECK (baseline IN (0, 1)),
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_page_snapshots_recent ON intelligence_page_snapshots(monitor_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_research_requests (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('competitor', 'exam')),
  target_id TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  observed_at TEXT,
  result_summary TEXT NOT NULL DEFAULT '',
  evidence_urls TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_urls)),
  result_hash TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_research_pending ON intelligence_research_requests(target_type, target_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS intelligence_research_requested ON intelligence_research_requests(requested_at DESC);

CREATE TABLE IF NOT EXISTS intelligence_competitor_observations (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_urls TEXT NOT NULL CHECK (json_valid(evidence_urls)),
  metrics TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metrics)),
  recent_items TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recent_items)),
  comparison TEXT NOT NULL CHECK (json_valid(comparison)),
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
  streams TEXT NOT NULL CHECK (json_valid(streams)),
  description TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  eligibility_notes TEXT NOT NULL DEFAULT '',
  reference_links TEXT NOT NULL CHECK (json_valid(reference_links)),
  milestones TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(milestones)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'tracking', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
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
  entry_routes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entry_routes)),
  reference_links TEXT NOT NULL CHECK (json_valid(reference_links)),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intelligence_career_pathways_stream ON intelligence_career_pathways(stream, field);

INSERT INTO workspace_metadata(key, value) VALUES ('intelligence_schema_version', '2')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
