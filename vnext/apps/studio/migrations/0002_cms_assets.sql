PRAGMA foreign_keys = ON;

CREATE TABLE cms_assets (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  alt TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_subject TEXT NOT NULL,
  updated_by_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX cms_assets_status_updated_idx
  ON cms_assets (status, updated_at DESC);
CREATE INDEX cms_assets_created_idx
  ON cms_assets (created_at DESC);

CREATE TABLE cms_asset_imports (
  id TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);

CREATE TABLE cms_asset_references (
  asset_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('markdown', 'hero')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, article_id, location),
  FOREIGN KEY (asset_id) REFERENCES cms_assets(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE CASCADE
);

CREATE INDEX cms_asset_references_article_idx
  ON cms_asset_references (article_id, asset_id);
