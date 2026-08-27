PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS cms_analytics_events_project_daily;

CREATE TABLE cms_analytics_events_next (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 36),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  event_date TEXT NOT NULL CHECK (length(event_date) = 10),
  occurred_at TEXT NOT NULL CHECK (julianday(occurred_at) IS NOT NULL),
  received_at TEXT NOT NULL CHECK (julianday(received_at) IS NOT NULL),
  article_id TEXT NOT NULL,
  article_slug TEXT NOT NULL COLLATE NOCASE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'landing',
    'article_50',
    'article_end',
    'navigation_click',
    'updates_click',
    'share',
    'assistant_open',
    'assistant_success',
    'assistant_error'
  )),
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  navigation_kind TEXT NOT NULL DEFAULT '' CHECK (navigation_kind IN ('', 'series_next', 'related')),
  target_slug TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  entry_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (entry_kind IN (
    'unknown',
    'direct',
    'external',
    'home',
    'article_index',
    'series',
    'topic',
    'article',
    'other_internal'
  ))
);

INSERT INTO cms_analytics_events_next (
  event_id, schema_version, event_date, occurred_at, received_at,
  article_id, article_slug, revision_number, event_type,
  source, medium, campaign, content, referrer_host,
  navigation_kind, target_slug, entry_kind
)
SELECT
  event_id, schema_version, event_date, occurred_at, received_at,
  article_id, article_slug, revision_number, event_type,
  source, medium, campaign, content, referrer_host,
  navigation_kind, target_slug, entry_kind
FROM cms_analytics_events;

CREATE TABLE cms_analytics_daily_next (
  event_date TEXT NOT NULL CHECK (length(event_date) = 10),
  article_id TEXT NOT NULL,
  article_slug TEXT NOT NULL COLLATE NOCASE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'landing',
    'article_50',
    'article_end',
    'navigation_click',
    'updates_click',
    'share',
    'assistant_open',
    'assistant_success',
    'assistant_error'
  )),
  source TEXT NOT NULL DEFAULT '',
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  referrer_host TEXT NOT NULL DEFAULT '',
  navigation_kind TEXT NOT NULL DEFAULT '' CHECK (navigation_kind IN ('', 'series_next', 'related')),
  target_slug TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    event_date,
    article_id,
    revision_number,
    event_type,
    source,
    medium,
    campaign,
    content,
    referrer_host,
    navigation_kind,
    target_slug
  )
);

INSERT INTO cms_analytics_daily_next (
  event_date, article_id, article_slug, revision_number, event_type,
  source, medium, campaign, content, referrer_host,
  navigation_kind, target_slug, event_count, updated_at
)
SELECT
  event_date, article_id, article_slug, revision_number, event_type,
  source, medium, campaign, content, referrer_host,
  navigation_kind, target_slug, event_count, updated_at
FROM cms_analytics_daily;

CREATE TABLE cms_analytics_entry_daily_next (
  event_date TEXT NOT NULL CHECK (length(event_date) = 10),
  article_id TEXT NOT NULL,
  article_slug TEXT NOT NULL COLLATE NOCASE,
  revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'landing',
    'article_50',
    'article_end',
    'navigation_click',
    'updates_click',
    'share',
    'assistant_open',
    'assistant_success',
    'assistant_error'
  )),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN (
    'unknown',
    'direct',
    'external',
    'home',
    'article_index',
    'series',
    'topic',
    'article',
    'other_internal'
  )),
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    event_date,
    article_id,
    revision_number,
    event_type,
    entry_kind
  )
);

INSERT INTO cms_analytics_entry_daily_next (
  event_date, article_id, article_slug, revision_number,
  event_type, entry_kind, event_count, updated_at
)
SELECT
  event_date, article_id, article_slug, revision_number,
  event_type, entry_kind, event_count, updated_at
FROM cms_analytics_entry_daily;

DROP TABLE cms_analytics_events;
DROP TABLE cms_analytics_daily;
DROP TABLE cms_analytics_entry_daily;

ALTER TABLE cms_analytics_events_next RENAME TO cms_analytics_events;
ALTER TABLE cms_analytics_daily_next RENAME TO cms_analytics_daily;
ALTER TABLE cms_analytics_entry_daily_next RENAME TO cms_analytics_entry_daily;

CREATE INDEX cms_analytics_events_date_idx
  ON cms_analytics_events (event_date DESC, event_type);

CREATE INDEX cms_analytics_events_article_idx
  ON cms_analytics_events (article_id, revision_number, event_date DESC);

CREATE INDEX cms_analytics_events_received_idx
  ON cms_analytics_events (received_at DESC);

CREATE INDEX cms_analytics_daily_date_idx
  ON cms_analytics_daily (event_date DESC, event_type);

CREATE INDEX cms_analytics_daily_article_idx
  ON cms_analytics_daily (article_id, revision_number, event_date DESC);

CREATE INDEX cms_analytics_daily_source_idx
  ON cms_analytics_daily (source, medium, campaign, content, event_date DESC);

CREATE INDEX cms_analytics_entry_daily_date_idx
  ON cms_analytics_entry_daily (event_date DESC, event_type);

CREATE INDEX cms_analytics_entry_daily_kind_idx
  ON cms_analytics_entry_daily (entry_kind, event_date DESC);

CREATE TRIGGER cms_analytics_events_project_daily
AFTER INSERT ON cms_analytics_events
BEGIN
  INSERT INTO cms_analytics_daily (
    event_date,
    article_id,
    article_slug,
    revision_number,
    event_type,
    source,
    medium,
    campaign,
    content,
    referrer_host,
    navigation_kind,
    target_slug,
    event_count,
    updated_at
  ) VALUES (
    NEW.event_date,
    NEW.article_id,
    NEW.article_slug,
    NEW.revision_number,
    NEW.event_type,
    NEW.source,
    NEW.medium,
    NEW.campaign,
    NEW.content,
    NEW.referrer_host,
    NEW.navigation_kind,
    NEW.target_slug,
    1,
    NEW.received_at
  )
  ON CONFLICT (
    event_date,
    article_id,
    revision_number,
    event_type,
    source,
    medium,
    campaign,
    content,
    referrer_host,
    navigation_kind,
    target_slug
  ) DO UPDATE SET
    event_count = cms_analytics_daily.event_count + 1,
    article_slug = excluded.article_slug,
    updated_at = excluded.updated_at;

  INSERT INTO cms_analytics_entry_daily (
    event_date,
    article_id,
    article_slug,
    revision_number,
    event_type,
    entry_kind,
    event_count,
    updated_at
  ) VALUES (
    NEW.event_date,
    NEW.article_id,
    NEW.article_slug,
    NEW.revision_number,
    NEW.event_type,
    NEW.entry_kind,
    1,
    NEW.received_at
  )
  ON CONFLICT (
    event_date,
    article_id,
    revision_number,
    event_type,
    entry_kind
  ) DO UPDATE SET
    event_count = cms_analytics_entry_daily.event_count + 1,
    article_slug = excluded.article_slug,
    updated_at = excluded.updated_at;

  INSERT INTO cms_analytics_ingestion_daily (
    event_date,
    accepted_event_count,
    duplicate_event_count,
    updated_at
  ) VALUES (NEW.event_date, 1, 0, NEW.received_at)
  ON CONFLICT (event_date) DO UPDATE SET
    accepted_event_count = cms_analytics_ingestion_daily.accepted_event_count + 1,
    updated_at = excluded.updated_at;

  DELETE FROM cms_analytics_events
  WHERE event_date < date(NEW.event_date, '-34 days');

  DELETE FROM cms_analytics_daily
  WHERE event_date < date(NEW.event_date, '-399 days');

  DELETE FROM cms_analytics_entry_daily
  WHERE event_date < date(NEW.event_date, '-399 days');

  DELETE FROM cms_analytics_ingestion_daily
  WHERE event_date < date(NEW.event_date, '-399 days');
END;
