CREATE TABLE IF NOT EXISTS workspace_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('manager', 'contributor')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  platforms TEXT NOT NULL CHECK (json_valid(platforms)),
  format TEXT NOT NULL CHECK (format IN ('Post', 'Carousel', 'Reel', 'Video', 'Article')),
  institution TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'rejected')),
  scheduled_at TEXT,
  language TEXT NOT NULL CHECK (language IN ('English', 'Kannada', 'English + Kannada')),
  owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  approved_revision INTEGER,
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  feedback TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  palette TEXT NOT NULL CHECK (palette IN ('violet', 'navy', 'sage', 'peach')),
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  CHECK (status NOT IN ('approved', 'scheduled') OR
    (approved_revision IS NOT NULL AND approved_revision = revision AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status != 'scheduled' OR scheduled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS posts_status_schedule ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS posts_owner ON posts(owner_id);

CREATE TABLE IF NOT EXISTS post_revisions (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  changed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, revision)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Exam update', 'Board update', 'Medical seats', 'Competitor', 'Content idea')),
  published_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  verified_by TEXT REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('new', 'saved', 'drafted', 'dismissed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  audience TEXT NOT NULL,
  content_angle TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('official', 'competitor', 'sample')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_drafts (
  opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'youtube', 'linkedin', 'google_business', 'website')),
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  monitoring_status TEXT NOT NULL CHECK (monitoring_status IN ('manual', 'ready', 'paused')),
  last_checked_at TEXT,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('manual', 'ready', 'paused')),
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_samples (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL CHECK (json_valid(data))
);
