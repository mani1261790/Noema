PRAGMA foreign_keys = ON;

CREATE TABLE cms_mcp_asset_idempotency (
  actor_subject TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_subject, tool_name, request_id),
  FOREIGN KEY (asset_id) REFERENCES cms_assets(id) ON DELETE CASCADE
);

CREATE INDEX cms_mcp_asset_idempotency_asset_idx
  ON cms_mcp_asset_idempotency (asset_id, created_at DESC);
