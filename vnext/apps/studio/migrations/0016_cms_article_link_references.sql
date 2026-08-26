CREATE TABLE cms_article_link_references (
  source_article_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('current', 'published')),
  target_slug TEXT NOT NULL COLLATE NOCASE,
  target_article_id TEXT,
  href TEXT NOT NULL,
  line INTEGER NOT NULL CHECK (line >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_article_id, source_kind, href, line),
  FOREIGN KEY (source_article_id) REFERENCES cms_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (target_article_id) REFERENCES cms_articles(id) ON DELETE RESTRICT
);

CREATE INDEX cms_article_link_references_target_idx
  ON cms_article_link_references (target_article_id);

CREATE INDEX cms_article_link_references_slug_idx
  ON cms_article_link_references (target_slug);
