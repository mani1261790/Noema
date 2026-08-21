PRAGMA foreign_keys = ON;

CREATE TABLE cms_asset_deletions (
  asset_id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  requested_by_subject TEXT NOT NULL,
  requested_at TEXT NOT NULL
);

CREATE INDEX cms_asset_deletions_requested_idx
  ON cms_asset_deletions (requested_at ASC);
