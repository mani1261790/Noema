PRAGMA foreign_keys = ON;

ALTER TABLE cms_analytics_events
  ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'unknown'
  CHECK (entry_kind IN (
    'unknown',
    'direct',
    'external',
    'home',
    'article_index',
    'series',
    'topic',
    'article',
    'other_internal'
  ));

CREATE TABLE cms_analytics_entry_daily (
  event_date TEXT NOT NULL CHECK (length(event_date) = 10),
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

CREATE INDEX cms_analytics_entry_daily_date_idx
  ON cms_analytics_entry_daily (event_date DESC, event_type);

CREATE INDEX cms_analytics_entry_daily_kind_idx
  ON cms_analytics_entry_daily (entry_kind, event_date DESC);

INSERT INTO cms_analytics_entry_daily (
  event_date,
  article_id,
  article_slug,
  revision_number,
  event_type,
  entry_kind,
  event_count,
  updated_at
)
SELECT
  event_date,
  article_id,
  MAX(article_slug),
  revision_number,
  event_type,
  entry_kind,
  COUNT(*),
  MAX(received_at)
FROM cms_analytics_events
GROUP BY
  event_date,
  article_id,
  revision_number,
  event_type,
  entry_kind;

INSERT OR IGNORE INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
) VALUES (
  'entry_coverage_complete_from',
  date('now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

DROP TRIGGER IF EXISTS cms_analytics_events_project_daily;

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
