PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS cms_analytics_events_project_daily;

WITH legacy_repairs AS (
  SELECT
    'article_discovery_legacy_invalid_event_count' AS state_key,
    COUNT(*) AS repair_count
  FROM cms_analytics_events
  WHERE event_type = 'navigation_click'
    AND (navigation_kind NOT IN ('series_next', 'related') OR target_slug = '')

  UNION ALL

  SELECT
    'article_discovery_legacy_normalized_event_count',
    COUNT(*)
  FROM cms_analytics_events
  WHERE event_type <> 'navigation_click'
    AND (navigation_kind <> '' OR target_slug <> '')

  UNION ALL

  SELECT
    'article_discovery_legacy_invalid_daily_count',
    COALESCE(SUM(event_count), 0)
  FROM cms_analytics_daily
  WHERE event_type = 'navigation_click'
    AND (navigation_kind NOT IN ('series_next', 'related') OR target_slug = '')

  UNION ALL

  SELECT
    'article_discovery_legacy_normalized_daily_count',
    COALESCE(SUM(event_count), 0)
  FROM cms_analytics_daily
  WHERE event_type <> 'navigation_click'
    AND (navigation_kind <> '' OR target_slug <> '')
)
INSERT INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
)
SELECT
  state_key,
  CAST(repair_count AS TEXT),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM legacy_repairs
WHERE true
ON CONFLICT (state_key) DO UPDATE SET
  state_value = excluded.state_value,
  updated_at = excluded.updated_at;

WITH invalid_navigation_events AS (
  SELECT event_date, COUNT(*) AS invalid_count
  FROM cms_analytics_events
  WHERE event_type = 'navigation_click'
    AND (navigation_kind NOT IN ('series_next', 'related') OR target_slug = '')
  GROUP BY event_date
)
UPDATE cms_analytics_ingestion_daily
SET
  accepted_event_count = MAX(
    0,
    accepted_event_count - COALESCE((
      SELECT invalid_count
      FROM invalid_navigation_events
      WHERE invalid_navigation_events.event_date = cms_analytics_ingestion_daily.event_date
    ), 0)
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE event_date IN (SELECT event_date FROM invalid_navigation_events);

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
    'discovery_click',
    'updates_click',
    'updates_action',
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
  navigation_kind TEXT NOT NULL DEFAULT '' CHECK (navigation_kind IN (
    '',
    'series_next',
    'related',
    'series_index',
    'topic',
    'article_index'
  )),
  target_slug TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  entry_kind TEXT NOT NULL DEFAULT 'unknown' CHECK (entry_kind IN (
    'unknown',
    'direct',
    'external',
    'home',
    'article_index',
    'article_search',
    'series',
    'topic',
    'article',
    'other_internal'
  )),
  CHECK (
    (event_type = 'navigation_click'
      AND navigation_kind IN ('series_next', 'related')
      AND target_slug <> '')
    OR (event_type = 'discovery_click'
      AND navigation_kind IN ('series_index', 'topic', 'article_index')
      AND target_slug = '')
    OR (event_type NOT IN ('navigation_click', 'discovery_click')
      AND navigation_kind = ''
      AND target_slug = '')
  )
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
  CASE WHEN event_type = 'navigation_click' THEN navigation_kind ELSE '' END,
  CASE WHEN event_type = 'navigation_click' THEN target_slug ELSE '' END,
  entry_kind
FROM cms_analytics_events
WHERE event_type <> 'navigation_click'
  OR (navigation_kind IN ('series_next', 'related') AND target_slug <> '');

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
    'discovery_click',
    'updates_click',
    'updates_action',
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
  navigation_kind TEXT NOT NULL DEFAULT '' CHECK (navigation_kind IN (
    '',
    'series_next',
    'related',
    'series_index',
    'topic',
    'article_index'
  )),
  target_slug TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 1),
  updated_at TEXT NOT NULL,
  CHECK (
    (event_type = 'navigation_click'
      AND navigation_kind IN ('series_next', 'related')
      AND target_slug <> '')
    OR (event_type = 'discovery_click'
      AND navigation_kind IN ('series_index', 'topic', 'article_index')
      AND target_slug = '')
    OR (event_type NOT IN ('navigation_click', 'discovery_click')
      AND navigation_kind = ''
      AND target_slug = '')
  ),
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
  event_date, article_id, MAX(article_slug), revision_number, event_type,
  source, medium, campaign, content, referrer_host,
  CASE WHEN event_type = 'navigation_click' THEN navigation_kind ELSE '' END,
  CASE WHEN event_type = 'navigation_click' THEN target_slug ELSE '' END,
  SUM(event_count), MAX(updated_at)
FROM cms_analytics_daily
WHERE event_type <> 'navigation_click'
  OR (navigation_kind IN ('series_next', 'related') AND target_slug <> '')
GROUP BY
  event_date,
  article_id,
  revision_number,
  event_type,
  source,
  medium,
  campaign,
  content,
  referrer_host,
  CASE WHEN event_type = 'navigation_click' THEN navigation_kind ELSE '' END,
  CASE WHEN event_type = 'navigation_click' THEN target_slug ELSE '' END;

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
    'discovery_click',
    'updates_click',
    'updates_action',
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
    'article_search',
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
WITH invalid_navigation_events AS (
  SELECT
    event_date,
    article_id,
    revision_number,
    event_type,
    entry_kind,
    COUNT(*) AS invalid_count
  FROM cms_analytics_events
  WHERE event_type = 'navigation_click'
    AND (navigation_kind NOT IN ('series_next', 'related') OR target_slug = '')
  GROUP BY
    event_date,
    article_id,
    revision_number,
    event_type,
    entry_kind
)
SELECT
  entry.event_date,
  entry.article_id,
  entry.article_slug,
  entry.revision_number,
  entry.event_type,
  entry.entry_kind,
  entry.event_count - COALESCE(invalid.invalid_count, 0),
  entry.updated_at
FROM cms_analytics_entry_daily entry
LEFT JOIN invalid_navigation_events invalid
  ON invalid.event_date = entry.event_date
 AND invalid.article_id = entry.article_id
 AND invalid.revision_number = entry.revision_number
 AND invalid.event_type = entry.event_type
 AND invalid.entry_kind = entry.entry_kind
WHERE entry.event_count > COALESCE(invalid.invalid_count, 0);

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

WITH discovery_coverage AS (
  SELECT
    date('now', '+1 day') AS complete_from,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS updated_at
), coverage_keys AS (
  SELECT 'raw_coverage_complete_from' AS state_key
  UNION ALL
  SELECT 'entry_coverage_complete_from'
)
INSERT INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
) SELECT
  coverage_keys.state_key,
  CASE
    WHEN cms_analytics_pipeline_state.state_value > discovery_coverage.complete_from
      THEN cms_analytics_pipeline_state.state_value
    ELSE discovery_coverage.complete_from
  END,
  discovery_coverage.updated_at
FROM discovery_coverage
CROSS JOIN coverage_keys
LEFT JOIN cms_analytics_pipeline_state
  ON cms_analytics_pipeline_state.state_key = coverage_keys.state_key
WHERE true
ON CONFLICT (state_key) DO UPDATE SET
  state_value = excluded.state_value,
  updated_at = excluded.updated_at;

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
