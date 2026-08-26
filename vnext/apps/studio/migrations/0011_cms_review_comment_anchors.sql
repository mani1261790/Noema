ALTER TABLE cms_review_comments ADD COLUMN anchor_start INTEGER;
ALTER TABLE cms_review_comments ADD COLUMN anchor_end INTEGER;
ALTER TABLE cms_review_comments ADD COLUMN anchor_quote TEXT;
ALTER TABLE cms_review_comments ADD COLUMN anchor_prefix TEXT;
ALTER TABLE cms_review_comments ADD COLUMN anchor_suffix TEXT;
ALTER TABLE cms_review_comments ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
  CHECK (status IN ('open', 'resolved'));
ALTER TABLE cms_review_comments ADD COLUMN resolved_at TEXT;
ALTER TABLE cms_review_comments ADD COLUMN resolved_by_subject TEXT
  REFERENCES cms_members(subject);
ALTER TABLE cms_review_comments ADD COLUMN resolved_revision_id TEXT
  REFERENCES cms_article_revisions(id);

CREATE INDEX cms_review_comments_status_idx
  ON cms_review_comments (article_id, status, created_at ASC);
