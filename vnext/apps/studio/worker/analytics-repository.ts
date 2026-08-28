import {
  CMS_ANALYTICS_ACQUISITION_CHANNEL_VERSION,
  CMS_ANALYTICS_EVENT_CONTRACT_VERSION,
  CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS,
  CMS_ANALYTICS_METRIC_CATALOG_VERSION,
  CMS_ANALYTICS_READER_SHARE_CAMPAIGN,
  CMS_ANALYTICS_READER_SHARE_MEDIUM,
  CMS_ANALYTICS_READER_SHARE_SOURCE,
  CMS_ANALYTICS_REPORTING_MART_RETENTION_DAYS,
  CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_URL,
  canCms,
  classifyCmsAnalyticsAcquisitionChannel,
  type CmsAnalyticsAcquisitionMetric,
  type CmsAnalyticsArticleMetric,
  type CmsAnalyticsCounts,
  type CmsAnalyticsDailyMetric,
  type CmsAnalyticsDays,
  type CmsAnalyticsEntryMetric,
  type CmsAnalyticsHealth,
  type CmsAnalyticsOnwardNavigationKind,
  type CmsAnalyticsOnwardPath,
  type CmsAnalyticsOrganicArticleMetric,
  type CmsAnalyticsQualityCheck,
  type CmsAnalyticsReaderShareArticleMetric,
  type CmsAnalyticsRebuildRequest,
  type CmsAnalyticsRebuildResult,
  type CmsAnalyticsSourceMetric,
  type CmsAnalyticsSummary,
  type CmsAnalyticsTotals,
  type CmsIdentity
} from "@noema/cms";
import { CmsRepositoryError } from "./cms-repository";

interface ArticleEventRow {
  article_id: string;
  article_slug: string;
  event_count: number;
  event_type: string;
  frontmatter_json: string | null;
  navigation_kind: string;
  revision_number: number;
}

interface SourceEventRow {
  campaign: string;
  content: string;
  event_count: number;
  event_type: string;
  medium: string;
  referrer_host: string;
  source: string;
}

interface AcquisitionArticleEventRow extends SourceEventRow {
  article_id: string;
  article_slug: string;
  frontmatter_json: string | null;
  revision_number: number;
}

interface DailyEventRow {
  event_count: number;
  event_date: string;
  event_type: string;
}

interface EntryEventRow {
  entry_kind: CmsAnalyticsEntryMetric["entryKind"];
  event_count: number;
  event_type: string;
}

interface OnwardPathRow {
  click_count: number;
  frontmatter_json: string | null;
  navigation_kind: CmsAnalyticsOnwardNavigationKind;
  source_article_id: string;
  source_revision_number: number;
  source_slug: string;
  target_frontmatter_json: string | null;
  target_slug: string;
}

interface IngestionHealthRow {
  accepted_event_count: number;
  duplicate_event_count: number;
  latest_received_at: string | null;
}

interface ReconciliationRow {
  entry_mart_event_count: number;
  mart_event_count: number;
  raw_event_count: number;
}

interface FactQualityRow {
  clock_skew_count: number;
  invalid_contract_count: number;
  orphan_revision_count: number;
}

function emptyCounts(): CmsAnalyticsCounts {
  return {
    article50: 0,
    articleEnd: 0,
    articleIndex: 0,
    assistantError: 0,
    assistantOpen: 0,
    assistantSuccess: 0,
    discoveryClick: 0,
    landing: 0,
    navigationClick: 0,
    relatedClick: 0,
    seriesIndex: 0,
    seriesNext: 0,
    share: 0,
    topicIndex: 0,
    updatesAction: 0,
    updatesClick: 0
  };
}

function addEvent(
  counts: CmsAnalyticsCounts,
  eventType: string,
  eventCount: number,
  navigationKind = ""
): void {
  if (eventType === "landing") counts.landing += eventCount;
  if (eventType === "article_50") counts.article50 += eventCount;
  if (eventType === "article_end") counts.articleEnd += eventCount;
  if (eventType === "updates_click") counts.updatesClick += eventCount;
  if (eventType === "updates_action") counts.updatesAction += eventCount;
  if (eventType === "share") counts.share += eventCount;
  if (eventType === "assistant_open") counts.assistantOpen += eventCount;
  if (eventType === "assistant_success") counts.assistantSuccess += eventCount;
  if (eventType === "assistant_error") counts.assistantError += eventCount;
  if (eventType === "discovery_click") {
    counts.discoveryClick += eventCount;
    if (navigationKind === "article_index") counts.articleIndex += eventCount;
    if (navigationKind === "series_index") counts.seriesIndex += eventCount;
    if (navigationKind === "topic") counts.topicIndex += eventCount;
  }
  if (eventType === "navigation_click") {
    counts.navigationClick += eventCount;
    if (navigationKind === "related") counts.relatedClick += eventCount;
    if (navigationKind === "series_next") counts.seriesNext += eventCount;
  }
}

interface AcquisitionCounts {
  article50: number;
  articleEnd: number;
  landing: number;
  navigationClick: number;
}

function emptyAcquisitionCounts(): AcquisitionCounts {
  return { article50: 0, articleEnd: 0, landing: 0, navigationClick: 0 };
}

function addAcquisitionEvent(
  counts: AcquisitionCounts,
  eventType: string,
  eventCount: number
): boolean {
  if (eventType === "landing") counts.landing += eventCount;
  else if (eventType === "article_50") counts.article50 += eventCount;
  else if (eventType === "article_end") counts.articleEnd += eventCount;
  else if (eventType === "navigation_click") counts.navigationClick += eventCount;
  else return false;
  return true;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function totalsWithRates(counts: CmsAnalyticsCounts): CmsAnalyticsTotals {
  return {
    ...counts,
    article50Rate: ratio(counts.article50, counts.landing),
    assistantSuccessRate: ratio(counts.assistantSuccess, counts.assistantOpen),
    assistantUseRate: ratio(counts.assistantOpen, counts.landing),
    discoveryRate: ratio(counts.discoveryClick, counts.articleEnd),
    onwardRate: ratio(counts.navigationClick, counts.articleEnd),
    qualifiedReadRate: ratio(counts.articleEnd, counts.landing),
    updatesActionRate: ratio(counts.updatesAction, counts.updatesClick),
    updatesGuideRate: ratio(counts.updatesClick, counts.articleEnd)
  };
}

function articleTitle(frontmatterJson: string | null, slug: string): string {
  if (!frontmatterJson) return slug;
  try {
    const value = JSON.parse(frontmatterJson) as unknown;
    if (
      value &&
      typeof value === "object" &&
      "title" in value &&
      typeof value.title === "string" &&
      value.title.trim()
    ) return value.title.trim();
  } catch {
    // Historic reporting remains available even if old metadata is malformed.
  }
  return slug;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

const ONWARD_PATH_LIMIT = 200;

export async function listCmsAnalyticsSummary(
  db: D1Database,
  identity: CmsIdentity,
  days: CmsAnalyticsDays,
  now = new Date()
): Promise<CmsAnalyticsSummary> {
  if (!canCms(identity.role, "view")) {
    throw new CmsRepositoryError("forbidden", "分析結果を表示する権限がありません。");
  }
  const through = now.toISOString().slice(0, 10);
  const from = addDays(new Date(`${through}T00:00:00.000Z`), -(days - 1))
    .toISOString()
    .slice(0, 10);
  const comparisonThrough = addDays(new Date(`${from}T00:00:00.000Z`), -1)
    .toISOString()
    .slice(0, 10);
  const comparisonFrom = addDays(new Date(`${comparisonThrough}T00:00:00.000Z`), -(days - 1))
    .toISOString()
    .slice(0, 10);

  const [coverage, entryCoverage] = await Promise.all([
    db.prepare(
      `SELECT state_value
       FROM cms_analytics_pipeline_state
       WHERE state_key = 'raw_coverage_complete_from'`
    ).first<{ state_value: string }>(),
    db.prepare(
      `SELECT state_value
       FROM cms_analytics_pipeline_state
       WHERE state_key = 'entry_coverage_complete_from'`
    ).first<{ state_value: string }>()
  ]);
  const rawCoverageFrom = coverage?.state_value ?? through;
  const entryCoverageFrom = entryCoverage?.state_value ?? through;
  const comparisonAvailableOn = addDays(
    new Date(`${rawCoverageFrom}T00:00:00.000Z`),
    (days * 2) - 1
  ).toISOString().slice(0, 10);
  const comparisonAvailable = comparisonFrom >= rawCoverageFrom;
  const retentionFrom = addDays(
    new Date(`${through}T00:00:00.000Z`),
    -(CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS - 1)
  )
    .toISOString()
    .slice(0, 10);
  const reprocessableFrom = rawCoverageFrom > retentionFrom ? rawCoverageFrom : retentionFrom;
  const reconciliationFrom = reprocessableFrom > from ? reprocessableFrom : from;

  const [articleResult, sourceResult, acquisitionArticleResult, entryResult, onwardPathResult, dailyResult, comparisonResult, ingestionHealth, reconciliation, factQuality] = await Promise.all([
    db.prepare(
      `SELECT
         d.article_id,
         d.article_slug,
         d.revision_number,
         d.event_type,
         d.navigation_kind,
         SUM(d.event_count) AS event_count,
         r.frontmatter_json
       FROM cms_analytics_daily d
       LEFT JOIN cms_article_revisions r
         ON r.article_id = d.article_id
        AND r.revision_number = d.revision_number
       WHERE d.event_date BETWEEN ?1 AND ?2
       GROUP BY
         d.article_id,
         d.article_slug,
         d.revision_number,
         d.event_type,
         d.navigation_kind,
         r.frontmatter_json`
    ).bind(from, through).all<ArticleEventRow>(),
    db.prepare(
      `SELECT
         source,
         medium,
         campaign,
         content,
         referrer_host,
         event_type,
         SUM(event_count) AS event_count
       FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY source, medium, campaign, content, referrer_host, event_type`
    ).bind(from, through).all<SourceEventRow>(),
    db.prepare(
      `SELECT
         d.article_id,
         d.article_slug,
         d.revision_number,
         d.source,
         d.medium,
         d.campaign,
         d.content,
         d.referrer_host,
         d.event_type,
         SUM(d.event_count) AS event_count,
         r.frontmatter_json
       FROM cms_analytics_daily d
       LEFT JOIN cms_article_revisions r
         ON r.article_id = d.article_id
        AND r.revision_number = d.revision_number
       WHERE d.event_date BETWEEN ?1 AND ?2
         AND d.event_type IN ('landing', 'article_50', 'article_end', 'navigation_click')
       GROUP BY
         d.article_id,
         d.article_slug,
         d.revision_number,
         d.source,
         d.medium,
         d.campaign,
         d.content,
         d.referrer_host,
         d.event_type,
         r.frontmatter_json`
    ).bind(from, through).all<AcquisitionArticleEventRow>(),
    db.prepare(
      `SELECT entry_kind, event_type, SUM(event_count) AS event_count
       FROM cms_analytics_entry_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY entry_kind, event_type`
    ).bind(from, through).all<EntryEventRow>(),
    db.prepare(
      `SELECT
         d.article_id AS source_article_id,
         d.article_slug AS source_slug,
         d.revision_number AS source_revision_number,
         d.navigation_kind,
         d.target_slug,
         SUM(d.event_count) AS click_count,
         source_revision.frontmatter_json,
         target_revision.frontmatter_json AS target_frontmatter_json
       FROM cms_analytics_daily d
       LEFT JOIN cms_article_revisions source_revision
         ON source_revision.article_id = d.article_id
        AND source_revision.revision_number = d.revision_number
       LEFT JOIN cms_articles target_article
         ON target_article.published_slug = d.target_slug COLLATE NOCASE
       LEFT JOIN cms_article_revisions target_revision
         ON target_revision.article_id = target_article.id
        AND target_revision.revision_number = target_article.published_revision_number
       WHERE d.event_date BETWEEN ?1 AND ?2
         AND d.event_type = 'navigation_click'
         AND d.navigation_kind IN ('series_next', 'related')
         AND d.target_slug <> ''
       GROUP BY
         d.article_id,
         d.article_slug,
         d.revision_number,
         d.navigation_kind,
         d.target_slug,
         source_revision.frontmatter_json,
         target_revision.frontmatter_json
       ORDER BY click_count DESC, source_slug ASC, navigation_kind ASC, target_slug ASC
       LIMIT ?3`
    ).bind(from, through, ONWARD_PATH_LIMIT + 1).all<OnwardPathRow>(),
    db.prepare(
      `SELECT event_date, event_type, SUM(event_count) AS event_count
       FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY event_date, event_type
       ORDER BY event_date ASC`
    ).bind(from, through).all<DailyEventRow>(),
    db.prepare(
      `SELECT '' AS event_date, event_type, navigation_kind, SUM(event_count) AS event_count
       FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY event_type, navigation_kind`
    ).bind(comparisonFrom, comparisonThrough).all<DailyEventRow & { navigation_kind: string }>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(accepted_event_count), 0) AS accepted_event_count,
         COALESCE(SUM(duplicate_event_count), 0) AS duplicate_event_count,
         (SELECT MAX(received_at)
          FROM cms_analytics_events
          WHERE event_date BETWEEN ?1 AND ?2) AS latest_received_at
       FROM cms_analytics_ingestion_daily
       WHERE event_date BETWEEN ?1 AND ?2`
    ).bind(from, through).first<IngestionHealthRow>(),
    reconciliationFrom <= through
      ? db.prepare(
        `SELECT
           (SELECT COUNT(*)
            FROM cms_analytics_events
            WHERE event_date BETWEEN ?1 AND ?2) AS raw_event_count,
           (SELECT COALESCE(SUM(event_count), 0)
            FROM cms_analytics_daily
            WHERE event_date BETWEEN ?1 AND ?2) AS mart_event_count,
           (SELECT COALESCE(SUM(event_count), 0)
            FROM cms_analytics_entry_daily
            WHERE event_date BETWEEN ?1 AND ?2) AS entry_mart_event_count`
      ).bind(reconciliationFrom, through).first<ReconciliationRow>()
      : Promise.resolve(null),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE
           WHEN e.schema_version <> 1
             OR julianday(e.occurred_at) IS NULL
             OR julianday(e.received_at) IS NULL
           THEN 1 ELSE 0 END), 0) AS invalid_contract_count,
         COALESCE(SUM(CASE
           WHEN ABS(julianday(e.received_at) - julianday(e.occurred_at)) > 1
           THEN 1 ELSE 0 END), 0) AS clock_skew_count,
         COALESCE(SUM(CASE WHEN r.article_id IS NULL THEN 1 ELSE 0 END), 0) AS orphan_revision_count
       FROM cms_analytics_events e
       LEFT JOIN cms_article_revisions r
         ON r.article_id = e.article_id
        AND r.revision_number = e.revision_number
       WHERE e.event_date BETWEEN ?1 AND ?2`
    ).bind(from, through).first<FactQualityRow>()
  ]);

  const articleMetrics = new Map<string, CmsAnalyticsArticleMetric>();
  for (const row of articleResult.results) {
    const key = `${row.article_id}:${row.revision_number}`;
    const metric = articleMetrics.get(key) ?? {
      ...emptyCounts(),
      articleId: row.article_id,
      article50Rate: null,
      assistantSuccessRate: null,
      assistantUseRate: null,
      discoveryRate: null,
      onwardRate: null,
      qualifiedReadRate: null,
      revisionNumber: row.revision_number,
      slug: row.article_slug,
      title: articleTitle(row.frontmatter_json, row.article_slug),
      updatesActionRate: null,
      updatesGuideRate: null
    };
    addEvent(metric, row.event_type, row.event_count, row.navigation_kind);
    articleMetrics.set(key, metric);
  }
  const articles = [...articleMetrics.values()].map((metric) => ({
    ...metric,
    article50Rate: ratio(metric.article50, metric.landing),
    assistantSuccessRate: ratio(metric.assistantSuccess, metric.assistantOpen),
    assistantUseRate: ratio(metric.assistantOpen, metric.landing),
    discoveryRate: ratio(metric.discoveryClick, metric.articleEnd),
    onwardRate: ratio(metric.navigationClick, metric.articleEnd),
    qualifiedReadRate: ratio(metric.articleEnd, metric.landing),
    updatesActionRate: ratio(metric.updatesAction, metric.updatesClick),
    updatesGuideRate: ratio(metric.updatesClick, metric.articleEnd)
  })).sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const sourceMetrics = new Map<string, CmsAnalyticsSourceMetric>();
  for (const row of sourceResult.results) {
    const key = [row.source, row.medium, row.campaign, row.content, row.referrer_host].join("\u0000");
    const metric = sourceMetrics.get(key) ?? {
      article50: 0,
      article50Rate: null,
      articleEnd: 0,
      campaign: row.campaign,
      content: row.content,
      landing: 0,
      medium: row.medium,
      navigationClick: 0,
      qualifiedReadRate: null,
      referrerHost: row.referrer_host,
      source: row.source,
      updatesClick: 0,
      updatesGuideRate: null
    };
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_50") metric.article50 += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    if (row.event_type === "updates_click") metric.updatesClick += row.event_count;
    sourceMetrics.set(key, metric);
  }
  const sources = [...sourceMetrics.values()]
    .filter((metric) => (
      metric.landing > 0 ||
      metric.article50 > 0 ||
      metric.articleEnd > 0 ||
      metric.navigationClick > 0 ||
      metric.updatesClick > 0
    ))
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing),
      updatesGuideRate: ratio(metric.updatesClick, metric.articleEnd)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const acquisitionChannelMetrics = new Map<
    CmsAnalyticsAcquisitionMetric["channel"],
    CmsAnalyticsAcquisitionMetric
  >();
  const organicArticleMetrics = new Map<string, CmsAnalyticsOrganicArticleMetric>();
  const readerShareArticleMetrics = new Map<string, CmsAnalyticsReaderShareArticleMetric>();
  for (const row of acquisitionArticleResult.results) {
    const channel = classifyCmsAnalyticsAcquisitionChannel({
      campaign: row.campaign || undefined,
      content: row.content || undefined,
      medium: row.medium || undefined,
      referrerHost: row.referrer_host || undefined,
      source: row.source || undefined
    });
    const channelMetric = acquisitionChannelMetrics.get(channel) ?? {
      ...emptyAcquisitionCounts(),
      article50Rate: null,
      channel,
      onwardRate: null,
      qualifiedReadRate: null
    };
    addAcquisitionEvent(channelMetric, row.event_type, row.event_count);
    acquisitionChannelMetrics.set(channel, channelMetric);

    if (channel === "organic_search") {
      const key = `${row.article_id}:${row.revision_number}`;
      const articleMetric = organicArticleMetrics.get(key) ?? {
        ...emptyAcquisitionCounts(),
        article50Rate: null,
        articleId: row.article_id,
        onwardRate: null,
        qualifiedReadRate: null,
        revisionNumber: row.revision_number,
        slug: row.article_slug,
        title: articleTitle(row.frontmatter_json, row.article_slug)
      };
      addAcquisitionEvent(articleMetric, row.event_type, row.event_count);
      organicArticleMetrics.set(key, articleMetric);
    }

    if (
      row.source === CMS_ANALYTICS_READER_SHARE_SOURCE &&
      row.medium === CMS_ANALYTICS_READER_SHARE_MEDIUM &&
      row.campaign === CMS_ANALYTICS_READER_SHARE_CAMPAIGN
    ) {
      const key = `${row.article_id}:${row.revision_number}:${row.content}`;
      const articleMetric = readerShareArticleMetrics.get(key) ?? {
        ...emptyAcquisitionCounts(),
        article50Rate: null,
        articleId: row.article_id,
        method: row.content,
        onwardRate: null,
        qualifiedReadRate: null,
        revisionNumber: row.revision_number,
        slug: row.article_slug,
        title: articleTitle(row.frontmatter_json, row.article_slug)
      };
      addAcquisitionEvent(articleMetric, row.event_type, row.event_count);
      readerShareArticleMetrics.set(key, articleMetric);
    }
  }
  const acquisitionChannels = [...acquisitionChannelMetrics.values()]
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      onwardRate: ratio(metric.navigationClick, metric.articleEnd),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);
  const organicSearchArticles = [...organicArticleMetrics.values()]
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      onwardRate: ratio(metric.navigationClick, metric.articleEnd),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);
  const readerShareArticles = [...readerShareArticleMetrics.values()]
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      onwardRate: ratio(metric.navigationClick, metric.articleEnd),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd || a.method.localeCompare(b.method));

  const entryMetrics = new Map<CmsAnalyticsEntryMetric["entryKind"], CmsAnalyticsEntryMetric>();
  for (const row of entryResult.results) {
    const metric = entryMetrics.get(row.entry_kind) ?? {
      article50: 0,
      article50Rate: null,
      articleEnd: 0,
      entryKind: row.entry_kind,
      landing: 0,
      navigationClick: 0,
      qualifiedReadRate: null,
      updatesClick: 0,
      updatesGuideRate: null
    };
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_50") metric.article50 += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    if (row.event_type === "updates_click") metric.updatesClick += row.event_count;
    entryMetrics.set(row.entry_kind, metric);
  }
  const entries = [...entryMetrics.values()]
    .filter((metric) => (
      metric.landing > 0 ||
      metric.article50 > 0 ||
      metric.articleEnd > 0 ||
      metric.navigationClick > 0 ||
      metric.updatesClick > 0
    ))
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing),
      updatesGuideRate: ratio(metric.updatesClick, metric.articleEnd)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const onwardPaths = onwardPathResult.results
    .slice(0, ONWARD_PATH_LIMIT)
    .map<CmsAnalyticsOnwardPath>((row) => ({
      clickCount: row.click_count,
      navigationKind: row.navigation_kind,
      sourceArticleId: row.source_article_id,
      sourceRevisionNumber: row.source_revision_number,
      sourceSlug: row.source_slug,
      sourceTitle: articleTitle(row.frontmatter_json, row.source_slug),
      targetSlug: row.target_slug,
      targetTitle: articleTitle(row.target_frontmatter_json, row.target_slug)
    }));

  const dailyByDate = new Map<string, CmsAnalyticsDailyMetric>();
  for (let index = 0; index < days; index += 1) {
    const date = addDays(new Date(`${from}T00:00:00.000Z`), index).toISOString().slice(0, 10);
    dailyByDate.set(date, { articleEnd: 0, date, discoveryClick: 0, landing: 0, navigationClick: 0, updatesAction: 0, updatesClick: 0 });
  }
  for (const row of dailyResult.results) {
    const metric = dailyByDate.get(row.event_date);
    if (!metric) continue;
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "discovery_click") metric.discoveryClick += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    if (row.event_type === "updates_click") metric.updatesClick += row.event_count;
    if (row.event_type === "updates_action") metric.updatesAction += row.event_count;
  }

  const totals = articles.reduce<CmsAnalyticsCounts>((counts, article) => {
    for (const key of Object.keys(counts) as Array<keyof CmsAnalyticsCounts>) {
      counts[key] += article[key];
    }
    return counts;
  }, emptyCounts());
  const comparisonCounts = emptyCounts();
  if (comparisonAvailable) {
    for (const row of comparisonResult.results) {
      addEvent(comparisonCounts, row.event_type, row.event_count, row.navigation_kind);
    }
  }

  const health = analyticsHealth({
    acceptedEvents: ingestionHealth?.accepted_event_count ?? 0,
    duplicateEvents: ingestionHealth?.duplicate_event_count ?? 0,
    entryCoverageFrom,
    generatedAt: now,
    factQuality: factQuality ?? {
      clock_skew_count: 0,
      invalid_contract_count: 0,
      orphan_revision_count: 0
    },
    latestEventReceivedAt: ingestionHealth?.latest_received_at ?? null,
    reconciliation,
    rawCoverageFrom,
    reprocessableFrom,
    totals
  });

  return {
    acquisitionChannels,
    articles,
    comparison: {
      availableOn: comparisonAvailableOn,
      range: { from: comparisonFrom, through: comparisonThrough },
      status: comparisonAvailable ? "available" : "collecting",
      totals: comparisonAvailable ? totalsWithRates(comparisonCounts) : null
    },
    daily: [...dailyByDate.values()],
    entries,
    health,
    onwardPaths,
    onwardPathsTruncated: onwardPathResult.results.length > ONWARD_PATH_LIMIT,
    organicSearchArticles,
    readerShareArticles,
    range: { days, from, through },
    sources,
    totals: totalsWithRates(totals)
  };
}

function analyticsHealth(options: {
  acceptedEvents: number;
  duplicateEvents: number;
  entryCoverageFrom: string;
  factQuality: FactQualityRow;
  generatedAt: Date;
  latestEventReceivedAt: string | null;
  reconciliation: ReconciliationRow | null;
  rawCoverageFrom: string;
  reprocessableFrom: string;
  totals: CmsAnalyticsCounts;
}): CmsAnalyticsHealth {
  const checks: CmsAnalyticsQualityCheck[] = [];
  const generatedAt = options.generatedAt.toISOString();
  const reportingEvents = options.totals.landing + options.totals.article50 +
    options.totals.articleEnd + options.totals.navigationClick + options.totals.discoveryClick + options.totals.share +
    options.totals.updatesClick + options.totals.updatesAction + options.totals.assistantOpen +
    options.totals.assistantSuccess + options.totals.assistantError;
  if (!options.latestEventReceivedAt) {
    checks.push({
      detail: options.acceptedEvents === 0
        ? "対象期間に受理済みイベントがありません。"
        : "保持中の35日イベント正本に受信記録がありません。収集経路を確認してください。",
      id: "freshness",
      label: "収集鮮度",
      status: options.acceptedEvents === 0 ? "not_evaluated" : "warn"
    });
  } else {
    const ageHours = Math.max(
      0,
      (options.generatedAt.getTime() - new Date(options.latestEventReceivedAt).getTime()) / 3_600_000
    );
    checks.push({
      detail: ageHours <= 24
        ? `最終受信は${formatHours(ageHours)}時間前です。`
        : `最終受信から${formatHours(ageHours)}時間経過しています。公開記事の稼働状況を確認してください。`,
      id: "freshness",
      label: "収集鮮度",
      status: ageHours <= 24 ? "pass" : "warn"
    });
  }

  const attempts = options.acceptedEvents + options.duplicateEvents;
  const duplicateRate = attempts > 0 ? options.duplicateEvents / attempts : null;
  checks.push({
    detail: duplicateRate === null
      ? "対象期間に収集試行がありません。"
      : `${options.duplicateEvents} / ${attempts}件（${(duplicateRate * 100).toFixed(1)}%）が重複として除外されました。`,
    id: "duplicate_rate",
    label: "重複排除",
    status: duplicateRate === null ? "not_evaluated" : duplicateRate <= 0.05 ? "pass" : "warn"
  });

  const contractIssues = options.factQuality.invalid_contract_count + options.factQuality.clock_skew_count;
  checks.push({
    detail: options.acceptedEvents === 0
      ? "対象期間に検査対象のイベントがありません。"
      : contractIssues === 0
        ? "契約v1と時刻形式に適合し、端末時刻と受信時刻の差は24時間以内です。"
        : `契約不適合${options.factQuality.invalid_contract_count}件、時刻差24時間超${options.factQuality.clock_skew_count}件です。`,
    id: "contract_conformance",
    label: "イベント契約",
    status: options.acceptedEvents === 0 ? "not_evaluated" : contractIssues === 0 ? "pass" : "warn"
  });

  checks.push({
    detail: options.acceptedEvents === 0
      ? "対象期間に検査対象のイベントがありません。"
      : options.factQuality.orphan_revision_count === 0
        ? "すべてのイベントをCMSの公開revisionへ解決できます。"
        : `${options.factQuality.orphan_revision_count}件をCMS revisionへ解決できません。`,
    id: "revision_lineage",
    label: "revision lineage",
    status: options.acceptedEvents === 0
      ? "not_evaluated"
      : options.factQuality.orphan_revision_count === 0 ? "pass" : "warn"
  });

  const martsReconcile = options.reconciliation
    ? options.reconciliation.raw_event_count === options.reconciliation.mart_event_count &&
      options.reconciliation.raw_event_count === options.reconciliation.entry_mart_event_count
    : false;
  checks.push({
    detail: options.reconciliation
      ? martsReconcile
        ? `再処理可能期間の${options.reconciliation.raw_event_count}件が日次・入口マートと一致しています。`
        : `イベント正本${options.reconciliation.raw_event_count}件に対し、日次マート${options.reconciliation.mart_event_count}件、入口マート${options.reconciliation.entry_mart_event_count}件です。再集計が必要です。`
      : `${options.rawCoverageFrom}から完全なイベント正本を収集中です。`,
    id: "mart_reconciliation",
    label: "正本・マート整合",
    status: !options.reconciliation
      ? "not_evaluated"
      : martsReconcile ? "pass" : "warn"
  });

  const inconsistent = [
    options.totals.article50 > options.totals.landing,
    options.totals.articleEnd > options.totals.landing,
    options.totals.navigationClick > options.totals.articleEnd,
    options.totals.discoveryClick > options.totals.articleEnd,
    options.totals.updatesClick > options.totals.articleEnd,
    options.totals.updatesAction > options.totals.updatesClick,
    options.totals.assistantSuccess > options.totals.assistantOpen
  ].some(Boolean);
  checks.push({
    detail: inconsistent
      ? "一部の分子イベントが対応する分母を上回っています。bot、欠測、期間境界を確認してください。"
      : "主要率の分子は対応する分母以下です。",
    id: "funnel_consistency",
    label: "指標整合",
    status: reportingEvents === 0 ? "not_evaluated" : inconsistent ? "warn" : "pass"
  });

  const status = options.acceptedEvents === 0 && reportingEvents === 0
    ? "no_data"
    : checks.some((check) => check.status === "warn")
      ? "attention"
      : checks.some((check) => check.status === "not_evaluated")
        ? "collecting"
        : "healthy";

  return {
    acceptedEvents: options.acceptedEvents,
    acquisitionChannelVersion: CMS_ANALYTICS_ACQUISITION_CHANNEL_VERSION,
    checks,
    duplicateEvents: options.duplicateEvents,
    entryCoverageFrom: options.entryCoverageFrom,
    eventContractVersion: CMS_ANALYTICS_EVENT_CONTRACT_VERSION,
    generatedAt,
    latestEventReceivedAt: options.latestEventReceivedAt,
    metricCatalogVersion: CMS_ANALYTICS_METRIC_CATALOG_VERSION,
    rawCoverageFrom: options.rawCoverageFrom,
    reprocessableFrom: options.reprocessableFrom,
    retention: {
      eventFactsDays: CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS,
      reportingMartDays: CMS_ANALYTICS_REPORTING_MART_RETENTION_DAYS
    },
    sources: [
      {
        id: "noema_reader_events",
        role: "記事内の読了、回遊、更新案内、RSS行動、共有、アシスタント利用",
        status: "active"
      },
      {
        accessUrl: CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
        id: "cloudflare_web_analytics",
        role: "実利用環境、ページ表示、Core Web VitalsをCloudflareで確認",
        status: "external"
      },
      {
        accessUrl: CMS_GOOGLE_SEARCH_CONSOLE_URL,
        id: "google_search_console",
        role: "検索実績、インデックス状況、サイトマップ、外部リンクをSearch Consoleで確認",
        status: "external"
      }
    ],
    status
  };
}

function formatHours(value: number): string {
  return value < 1 ? value.toFixed(1) : value.toFixed(0);
}

export async function cleanupCmsAnalyticsRetention(
  db: D1Database,
  now = new Date()
): Promise<void> {
  const today = now.toISOString().slice(0, 10);
  const eventFactsCutoff = addDays(
    new Date(`${today}T00:00:00.000Z`),
    -(CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS - 1)
  )
    .toISOString()
    .slice(0, 10);
  const reportingCutoff = addDays(
    new Date(`${today}T00:00:00.000Z`),
    -(CMS_ANALYTICS_REPORTING_MART_RETENTION_DAYS - 1)
  )
    .toISOString()
    .slice(0, 10);
  await db.batch([
    db.prepare("DELETE FROM cms_analytics_events WHERE event_date < ?1")
      .bind(eventFactsCutoff),
    db.prepare("DELETE FROM cms_analytics_daily WHERE event_date < ?1")
      .bind(reportingCutoff),
    db.prepare("DELETE FROM cms_analytics_entry_daily WHERE event_date < ?1")
      .bind(reportingCutoff),
    db.prepare("DELETE FROM cms_analytics_ingestion_daily WHERE event_date < ?1")
      .bind(reportingCutoff)
  ]);
}

export async function rebuildCmsAnalyticsMart(
  db: D1Database,
  identity: CmsIdentity,
  range: CmsAnalyticsRebuildRequest,
  now = new Date()
): Promise<CmsAnalyticsRebuildResult> {
  if (identity.role !== "admin") {
    throw new CmsRepositoryError("forbidden", "分析マートを再集計する権限がありません。");
  }
  const today = now.toISOString().slice(0, 10);
  const coverage = await db.prepare(
    `SELECT state_value
     FROM cms_analytics_pipeline_state
     WHERE state_key = 'raw_coverage_complete_from'`
  ).first<{ state_value: string }>();
  const rawCoverageFrom = coverage?.state_value;
  const retentionFrom = addDays(
    new Date(`${today}T00:00:00.000Z`),
    -(CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS - 1)
  )
    .toISOString()
    .slice(0, 10);
  const reprocessableFrom = rawCoverageFrom && rawCoverageFrom > retentionFrom
    ? rawCoverageFrom
    : retentionFrom;
  const fromDate = new Date(`${range.from}T00:00:00.000Z`);
  const throughDate = new Date(`${range.through}T00:00:00.000Z`);
  const inclusiveDays = Math.floor((throughDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (
    !rawCoverageFrom ||
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(throughDate.getTime()) ||
    range.from < reprocessableFrom ||
    range.through > today ||
    inclusiveDays < 1 ||
    inclusiveDays > CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS
  ) {
    throw new CmsRepositoryError(
      "invalid_analytics_rebuild_range",
      `再集計は${reprocessableFrom}以降、当日までの連続35日以内を指定してください。`
    );
  }

  const runId = crypto.randomUUID();
  const startedAt = now.toISOString();
  const completedAt = startedAt;
  const [countResult] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM cms_analytics_events
       WHERE event_date BETWEEN ?1 AND ?2`
    ).bind(range.from, range.through),
    db.prepare(
      `DELETE FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2`
    ).bind(range.from, range.through),
    db.prepare(
      `INSERT INTO cms_analytics_daily (
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
       )
       SELECT
         event_date,
         article_id,
         MAX(article_slug),
         revision_number,
         event_type,
         source,
         medium,
         campaign,
         content,
         referrer_host,
         navigation_kind,
         target_slug,
         COUNT(*),
         MAX(received_at)
       FROM cms_analytics_events
       WHERE event_date BETWEEN ?1 AND ?2
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
         navigation_kind,
         target_slug`
    ).bind(range.from, range.through),
    db.prepare(
      `DELETE FROM cms_analytics_entry_daily
       WHERE event_date BETWEEN ?1 AND ?2`
    ).bind(range.from, range.through),
    db.prepare(
      `INSERT INTO cms_analytics_entry_daily (
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
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY
         event_date,
         article_id,
         revision_number,
         event_type,
         entry_kind`
    ).bind(range.from, range.through),
    db.prepare(
      `INSERT INTO cms_analytics_pipeline_runs (
         id,
         run_type,
         range_from,
         range_through,
         source_event_count,
         started_at,
         completed_at,
         initiated_by
       )
       SELECT ?1, 'rebuild', ?2, ?3, COUNT(*), ?4, ?5, ?6
       FROM cms_analytics_events
       WHERE event_date BETWEEN ?2 AND ?3`
    ).bind(
      runId,
      range.from,
      range.through,
      startedAt,
      completedAt,
      identity.subject
    )
  ]);
  const countRow = countResult.results[0] as { count?: unknown } | undefined;
  const sourceEventCount = typeof countRow?.count === "number" ? countRow.count : 0;
  return { completedAt, from: range.from, runId, sourceEventCount, through: range.through };
}
