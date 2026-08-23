CREATE TABLE cms_discord_notification_outbox (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'article_created',
    'review_requested',
    'article_published'
  )),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN (
    'public',
    'unlisted',
    'restricted',
    'internal'
  )),
  created_at TEXT NOT NULL,
  queued_at TEXT,
  delivered_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT
);

CREATE INDEX cms_discord_notification_outbox_pending_idx
  ON cms_discord_notification_outbox (delivered_at, queued_at, created_at);
