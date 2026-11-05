ALTER TABLE posts ADD COLUMN asset_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(asset_ids));
ALTER TABLE posts ADD COLUMN publication_options TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(publication_options));
ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(event_id, user_id)
);
CREATE INDEX notifications_user_date ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications(user_id, read_at);

CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sound INTEGER NOT NULL DEFAULT 0 CHECK(sound IN(0,1)),
  desktop INTEGER NOT NULL DEFAULT 0 CHECK(desktop IN(0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  PRIMARY KEY(document_id, version)
);
INSERT INTO document_revisions(document_id, version, title, category, content, updated_at)
  SELECT id, version, title, category, content, updated_at FROM documents;

CREATE TABLE media_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','video/mp4')),
  expected_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('pending','checking','completed','failed')),
  lease_id TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  error TEXT
);
CREATE INDEX media_uploads_owner_date ON media_uploads(owner_id, created_at);
