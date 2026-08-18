CREATE TABLE cms_mcp_idempotency (
  actor_subject TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_id TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  article_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_subject, tool_name, request_id)
);

CREATE INDEX cms_mcp_idempotency_article_idx
  ON cms_mcp_idempotency (article_id, created_at DESC);

CREATE TRIGGER cms_articles_delete_mcp_idempotency
AFTER DELETE ON cms_articles
BEGIN
  DELETE FROM cms_mcp_idempotency WHERE article_id = OLD.id;
END;
