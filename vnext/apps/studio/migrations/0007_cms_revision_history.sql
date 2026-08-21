ALTER TABLE cms_article_revisions ADD COLUMN edit_session_id TEXT;
ALTER TABLE cms_article_revisions ADD COLUMN save_reason TEXT NOT NULL DEFAULT 'legacy'
  CHECK (save_reason IN ('legacy', 'created', 'autosave', 'manual', 'conflict_resolution', 'restored'));
ALTER TABLE cms_article_revisions ADD COLUMN source_revision_id TEXT;
ALTER TABLE cms_article_revisions ADD COLUMN draft_visibility TEXT
  CHECK (draft_visibility IN ('public', 'unlisted', 'restricted', 'internal'));

UPDATE cms_article_revisions
SET draft_visibility = (
  SELECT draft_visibility
  FROM cms_articles
  WHERE cms_articles.id = cms_article_revisions.article_id
)
WHERE id IN (SELECT current_revision_id FROM cms_articles);

UPDATE cms_article_revisions
SET draft_visibility = (
  SELECT published_visibility
  FROM cms_articles
  WHERE cms_articles.id = cms_article_revisions.article_id
)
WHERE id IN (SELECT published_revision_id FROM cms_articles)
  AND draft_visibility IS NULL;

CREATE INDEX cms_article_revisions_session_idx
  ON cms_article_revisions (
    article_id,
    COALESCE(edit_session_id, id),
    revision_number DESC
  );
