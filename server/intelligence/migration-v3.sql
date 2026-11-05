CREATE TABLE IF NOT EXISTS intelligence_youtube_subscriptions (
  watch_id TEXT PRIMARY KEY REFERENCES intelligence_watches(id) ON DELETE CASCADE,
  callback_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
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
  failures INTEGER NOT NULL DEFAULT 0,
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
