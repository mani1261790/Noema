PRAGMA foreign_keys = ON;

CREATE TABLE cms_series (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version >= 1),
  current_revision_id TEXT NOT NULL,
  current_revision_number INTEGER NOT NULL DEFAULT 1 CHECK (current_revision_number >= 1),
  published_revision_id TEXT NOT NULL,
  created_by_subject TEXT NOT NULL,
  updated_by_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX cms_series_updated_idx ON cms_series (updated_at DESC, id ASC);

CREATE TABLE cms_series_revisions (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  restored_from_revision_id TEXT,
  created_by_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (series_id) REFERENCES cms_series(id) ON DELETE CASCADE,
  FOREIGN KEY (restored_from_revision_id) REFERENCES cms_series_revisions(id) ON DELETE SET NULL,
  UNIQUE (series_id, revision_number)
);

CREATE INDEX cms_series_revisions_series_idx
  ON cms_series_revisions (series_id, revision_number DESC);

CREATE TABLE cms_series_revision_items (
  revision_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (revision_id, position),
  UNIQUE (revision_id, article_id),
  FOREIGN KEY (revision_id) REFERENCES cms_series_revisions(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE RESTRICT
);

CREATE INDEX cms_series_revision_items_article_idx
  ON cms_series_revision_items (article_id, revision_id);

CREATE TABLE cms_article_series (
  article_id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (series_id) REFERENCES cms_series(id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id) REFERENCES cms_series_revisions(id) ON DELETE CASCADE,
  UNIQUE (series_id, position)
);

CREATE INDEX cms_article_series_series_idx
  ON cms_article_series (series_id, position);
