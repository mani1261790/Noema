-- Once edited via MCP, an article keeps its proofreading requirement across web edits/restores.
ALTER TABLE cms_articles ADD COLUMN proofreading_required INTEGER NOT NULL DEFAULT 0 CHECK (proofreading_required IN (0, 1));
ALTER TABLE cms_article_revisions ADD COLUMN proofreading_json TEXT;

-- Existing MCP-authored articles also require a fresh record at their next workflow transition.
UPDATE cms_articles SET proofreading_required = 1
WHERE id IN (
  SELECT article_id FROM cms_audit_events
  WHERE action IN ('article.created', 'article.revised')
    AND json_extract(metadata_json, '$.channel') = 'mcp'
);
