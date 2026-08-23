PRAGMA foreign_keys = ON;

CREATE TABLE cms_analytics_daily (
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

CREATE INDEX cms_analytics_daily_date_idx
  ON cms_analytics_daily (event_date DESC, event_type);

CREATE INDEX cms_analytics_daily_article_idx
  ON cms_analytics_daily (article_id, revision_number, event_date DESC);

CREATE INDEX cms_analytics_daily_source_idx
  ON cms_analytics_daily (source, medium, campaign, content, event_date DESC);

CREATE TRIGGER cms_analytics_daily_retain_reporting_window
AFTER INSERT ON cms_analytics_daily
BEGIN
  DELETE FROM cms_analytics_daily
  WHERE event_date < date(NEW.event_date, '-89 days');
END;
