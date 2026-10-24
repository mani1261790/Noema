CREATE TABLE reader_comments (
 id TEXT PRIMARY KEY,
 article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
 parent_id TEXT REFERENCES reader_comments(id) ON DELETE CASCADE,
 author_name TEXT NOT NULL,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('reader','staff')),
 body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','hidden','deleted')),
 owner_hash TEXT,
 staff_subject TEXT,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 moderated_by TEXT,
 moderated_at INTEGER
);
CREATE INDEX reader_comments_article ON reader_comments(article_id, status, created_at, id);
CREATE INDEX reader_comments_moderation ON reader_comments(status, created_at);
CREATE INDEX reader_comments_parent ON reader_comments(parent_id);
CREATE INDEX reader_comments_reader_created ON reader_comments(author_kind, created_at);
