ALTER TABLE users ADD COLUMN setup_pending INTEGER NOT NULL DEFAULT 0 CHECK (setup_pending IN (0, 1));
ALTER TABLE posts ADD COLUMN asset_id TEXT;
ALTER TABLE posts ADD COLUMN destination_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(destination_ids));

CREATE TABLE IF NOT EXISTS account_setup_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'recovery')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS account_setup_expiry ON account_setup_tokens(expires_at);
CREATE INDEX IF NOT EXISTS account_setup_user ON account_setup_tokens(user_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_expiry ON login_attempts(reset_at);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS post_comments_post ON post_comments(post_id, created_at);
