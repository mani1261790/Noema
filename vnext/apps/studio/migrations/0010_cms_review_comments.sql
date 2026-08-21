CREATE TABLE cms_review_comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES cms_article_revisions(id) ON DELETE CASCADE,
  author_subject TEXT NOT NULL REFERENCES cms_members(subject),
  target TEXT NOT NULL CHECK (target IN ('article', 'body', 'metadata')),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);

CREATE INDEX cms_review_comments_article_idx
  ON cms_review_comments (article_id, created_at ASC);

CREATE INDEX cms_review_comments_revision_idx
  ON cms_review_comments (revision_id, created_at ASC);
