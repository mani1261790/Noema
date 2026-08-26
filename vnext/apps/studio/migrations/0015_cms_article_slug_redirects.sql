CREATE TABLE cms_article_slug_redirects (
  old_slug TEXT PRIMARY KEY COLLATE NOCASE,
  article_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE CASCADE
);

CREATE INDEX cms_article_slug_redirects_article_idx
  ON cms_article_slug_redirects (article_id, created_at DESC);
