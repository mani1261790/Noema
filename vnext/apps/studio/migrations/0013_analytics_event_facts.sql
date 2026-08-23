PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS cms_analytics_daily_retain_reporting_window;

CREATE TABLE cms_analytics_events (
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
  target_slug TEXT NOT NULL DEFAULT '' COLLATE NOCASE
);

CREATE INDEX cms_analytics_events_date_idx
  ON cms_analytics_events (event_date DESC, event_type);

CREATE INDEX cms_analytics_events_article_idx
  ON cms_analytics_events (article_id, revision_number, event_date DESC);

CREATE INDEX cms_analytics_events_received_idx
  ON cms_analytics_events (received_at DESC);

CREATE TABLE cms_analytics_ingestion_daily (
  event_date TEXT PRIMARY KEY CHECK (length(event_date) = 10),
  accepted_event_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_event_count >= 0),
  duplicate_event_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_event_count >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE cms_analytics_pipeline_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO cms_analytics_pipeline_state (state_key, state_value, updated_at)
VALUES (
  'raw_coverage_complete_from',
  date('now', '+1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

CREATE TABLE cms_analytics_pipeline_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK (run_type IN ('rebuild')),
  range_from TEXT NOT NULL CHECK (length(range_from) = 10),
  range_through TEXT NOT NULL CHECK (length(range_through) = 10),
  source_event_count INTEGER NOT NULL CHECK (source_event_count >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  initiated_by TEXT NOT NULL
);

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

  DELETE FROM cms_analytics_ingestion_daily
  WHERE event_date < date(NEW.event_date, '-399 days');
END;
