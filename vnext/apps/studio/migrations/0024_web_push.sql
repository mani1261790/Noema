CREATE TABLE reader_push_subscriptions (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE TABLE reader_push_events (
  article_id TEXT PRIMARY KEY REFERENCES cms_articles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expanded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reader_push_deliveries (
  article_id TEXT NOT NULL REFERENCES reader_push_events(article_id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES reader_push_subscriptions(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  PRIMARY KEY(article_id, subscription_id)
);
CREATE INDEX reader_push_pending ON reader_push_deliveries(status, next_attempt, lease_until);
-- Existing and previously published articles must never generate a launch burst.
INSERT INTO reader_push_events(article_id, expanded)
SELECT id, 1 FROM cms_articles WHERE published_at IS NOT NULL OR publication_status = 'published';
-- The event is in the same transaction as publication, including MCP publication.
CREATE TRIGGER reader_push_first_publication AFTER UPDATE ON cms_articles
WHEN NEW.publication_status = 'published' AND NEW.published_visibility = 'public'
BEGIN
  INSERT OR IGNORE INTO reader_push_events(article_id) VALUES (NEW.id);
END;
