INSERT INTO workspace_metadata(key,value)
SELECT 'workspace_owner_id',id FROM users
WHERE role='manager' AND active=1 ORDER BY created_at,id LIMIT 1
ON CONFLICT(key) DO NOTHING;

CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  encrypted_secret TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE mcp_authorization_requests (
  request_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes TEXT NOT NULL CHECK(json_valid(scopes)),
  resource TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  session_hash TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE mcp_grants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL CHECK(json_valid(scopes)),
  resource TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX mcp_grants_user ON mcp_grants(user_id,revoked_at);
CREATE TABLE mcp_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE mcp_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('access','refresh')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);
CREATE TABLE mcp_write_receipts (
  grant_id TEXT NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(grant_id,idempotency_key)
);
CREATE TABLE mcp_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
