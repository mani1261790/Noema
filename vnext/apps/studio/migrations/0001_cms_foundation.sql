PRAGMA foreign_keys = ON;

CREATE TABLE cms_member_invitations (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reviewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  invited_by_subject TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cms_members (
  subject TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reviewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER cms_members_keep_active_admin
BEFORE UPDATE OF role, active ON cms_members
WHEN OLD.role = 'admin'
  AND OLD.active = 1
  AND (NEW.role <> 'admin' OR NEW.active <> 1)
  AND NOT EXISTS (
    SELECT 1
    FROM cms_members
    WHERE subject <> OLD.subject AND role = 'admin' AND active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'last_active_cms_admin_required');
END;

CREATE TABLE cms_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  review_status TEXT NOT NULL CHECK (review_status IN ('draft', 'in_review', 'changes_requested', 'approved')),
  publication_status TEXT NOT NULL CHECK (publication_status IN ('unpublished', 'published', 'archived')),
  draft_visibility TEXT NOT NULL CHECK (draft_visibility IN ('public', 'unlisted', 'restricted', 'internal')),
  published_visibility TEXT CHECK (published_visibility IN ('public', 'unlisted', 'restricted', 'internal')),
  published_slug TEXT COLLATE NOCASE,
  lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version >= 1),
  current_revision_id TEXT NOT NULL,
  current_revision_number INTEGER NOT NULL DEFAULT 1 CHECK (current_revision_number >= 1),
  approved_revision_id TEXT,
  published_revision_id TEXT,
  published_revision_number INTEGER,
  review_note TEXT,
  created_by_subject TEXT NOT NULL,
  updated_by_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  review_requested_at TEXT,
  reviewed_at TEXT,
  reviewed_by_subject TEXT,
  published_at TEXT
);

CREATE INDEX cms_articles_review_updated_idx
  ON cms_articles (review_status, updated_at DESC);
CREATE INDEX cms_articles_publication_idx
  ON cms_articles (publication_status, published_visibility, published_at DESC);
CREATE UNIQUE INDEX cms_articles_active_published_slug_idx
  ON cms_articles (published_slug)
  WHERE publication_status = 'published';

CREATE TABLE cms_article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  frontmatter_json TEXT NOT NULL,
  markdown TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  created_by_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE CASCADE,
  UNIQUE (article_id, revision_number)
);

CREATE INDEX cms_article_revisions_article_idx
  ON cms_article_revisions (article_id, revision_number DESC);

CREATE TABLE cms_article_audiences (
  article_id TEXT NOT NULL,
  member_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_subject TEXT NOT NULL,
  PRIMARY KEY (article_id, member_subject),
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE CASCADE,
  FOREIGN KEY (member_subject) REFERENCES cms_members(subject) ON DELETE CASCADE
);

CREATE TABLE cms_audit_events (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES cms_articles(id) ON DELETE SET NULL
);

CREATE INDEX cms_audit_events_article_idx
  ON cms_audit_events (article_id, created_at DESC);
