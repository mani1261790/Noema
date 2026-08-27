import {
  CMS_ANALYTICS_EVENT_CONTRACT_VERSION,
  CMS_ANALYTICS_METRIC_CATALOG_VERSION,
  canCms,
  type CmsAnalyticsArticleMetric,
  type CmsAnalyticsCounts,
  type CmsAnalyticsDailyMetric,
  type CmsAnalyticsDays,
  type CmsAnalyticsEntryMetric,
  type CmsAnalyticsHealth,
  type CmsAnalyticsQualityCheck,
  type CmsAnalyticsRebuildRequest,
  type CmsAnalyticsRebuildResult,
  type CmsAnalyticsSourceMetric,
  type CmsAnalyticsSummary,
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
    assistantError: 0,
    assistantOpen: 0,
    assistantSuccess: 0,
    landing: 0,
    navigationClick: 0,
    relatedClick: 0,
    seriesNext: 0,
    share: 0
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
  if (eventType === "share") counts.share += eventCount;
  if (eventType === "assistant_open") counts.assistantOpen += eventCount;
  if (eventType === "assistant_success") counts.assistantSuccess += eventCount;
  if (eventType === "assistant_error") counts.assistantError += eventCount;
  if (eventType === "navigation_click") {
    counts.navigationClick += eventCount;
    if (navigationKind === "related") counts.relatedClick += eventCount;
    if (navigationKind === "series_next") counts.seriesNext += eventCount;
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
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
  const retentionFrom = addDays(new Date(`${through}T00:00:00.000Z`), -34)
    .toISOString()
    .slice(0, 10);
  const reprocessableFrom = rawCoverageFrom > retentionFrom ? rawCoverageFrom : retentionFrom;
  const reconciliationFrom = reprocessableFrom > from ? reprocessableFrom : from;

  const [articleResult, sourceResult, entryResult, dailyResult, ingestionHealth, reconciliation, factQuality] = await Promise.all([
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
      `SELECT entry_kind, event_type, SUM(event_count) AS event_count
       FROM cms_analytics_entry_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY entry_kind, event_type`
    ).bind(from, through).all<EntryEventRow>(),
    db.prepare(
      `SELECT event_date, event_type, SUM(event_count) AS event_count
       FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY event_date, event_type
       ORDER BY event_date ASC`
    ).bind(from, through).all<DailyEventRow>(),
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
      onwardRate: null,
      qualifiedReadRate: null,
      revisionNumber: row.revision_number,
      slug: row.article_slug,
      title: articleTitle(row.frontmatter_json, row.article_slug)
    };
    addEvent(metric, row.event_type, row.event_count, row.navigation_kind);
    articleMetrics.set(key, metric);
  }
  const articles = [...articleMetrics.values()].map((metric) => ({
    ...metric,
    article50Rate: ratio(metric.article50, metric.landing),
    assistantSuccessRate: ratio(metric.assistantSuccess, metric.assistantOpen),
    assistantUseRate: ratio(metric.assistantOpen, metric.landing),
    onwardRate: ratio(metric.navigationClick, metric.articleEnd),
    qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
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
      source: row.source
    };
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_50") metric.article50 += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    sourceMetrics.set(key, metric);
  }
  const sources = [...sourceMetrics.values()]
    .filter((metric) => (
      metric.landing > 0 ||
      metric.article50 > 0 ||
      metric.articleEnd > 0 ||
      metric.navigationClick > 0
    ))
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const entryMetrics = new Map<CmsAnalyticsEntryMetric["entryKind"], CmsAnalyticsEntryMetric>();
  for (const row of entryResult.results) {
    const metric = entryMetrics.get(row.entry_kind) ?? {
      article50: 0,
      article50Rate: null,
      articleEnd: 0,
      entryKind: row.entry_kind,
      landing: 0,
      navigationClick: 0,
      qualifiedReadRate: null
    };
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_50") metric.article50 += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    entryMetrics.set(row.entry_kind, metric);
  }
  const entries = [...entryMetrics.values()]
    .filter((metric) => (
      metric.landing > 0 ||
      metric.article50 > 0 ||
      metric.articleEnd > 0 ||
      metric.navigationClick > 0
    ))
    .map((metric) => ({
      ...metric,
      article50Rate: ratio(metric.article50, metric.landing),
      qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
    }))
    .sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const dailyByDate = new Map<string, CmsAnalyticsDailyMetric>();
  for (let index = 0; index < days; index += 1) {
    const date = addDays(new Date(`${from}T00:00:00.000Z`), index).toISOString().slice(0, 10);
    dailyByDate.set(date, { articleEnd: 0, date, landing: 0, navigationClick: 0 });
  }
  for (const row of dailyResult.results) {
    const metric = dailyByDate.get(row.event_date);
    if (!metric) continue;
    if (row.event_type === "landing") metric.landing += row.event_count;
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
  }

  const totals = articles.reduce<CmsAnalyticsCounts>((counts, article) => {
    for (const key of Object.keys(counts) as Array<keyof CmsAnalyticsCounts>) {
      counts[key] += article[key];
    }
    return counts;
  }, emptyCounts());

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
    articles,
    daily: [...dailyByDate.values()],
    entries,
    health,
    range: { days, from, through },
    sources,
    totals: {
      ...totals,
      article50Rate: ratio(totals.article50, totals.landing),
      assistantSuccessRate: ratio(totals.assistantSuccess, totals.assistantOpen),
      assistantUseRate: ratio(totals.assistantOpen, totals.landing),
      onwardRate: ratio(totals.navigationClick, totals.articleEnd),
      qualifiedReadRate: ratio(totals.articleEnd, totals.landing)
    }
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
    options.totals.articleEnd + options.totals.navigationClick + options.totals.share +
    options.totals.assistantOpen + options.totals.assistantSuccess + options.totals.assistantError;
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
    checks,
    duplicateEvents: options.duplicateEvents,
    entryCoverageFrom: options.entryCoverageFrom,
    eventContractVersion: CMS_ANALYTICS_EVENT_CONTRACT_VERSION,
    generatedAt,
    latestEventReceivedAt: options.latestEventReceivedAt,
    metricCatalogVersion: CMS_ANALYTICS_METRIC_CATALOG_VERSION,
    rawCoverageFrom: options.rawCoverageFrom,
    reprocessableFrom: options.reprocessableFrom,
    retention: { eventFactsDays: 35, reportingMartDays: 400 },
    sources: [
      {
        id: "noema_reader_events",
        role: "記事内の読了、回遊、共有、アシスタント利用",
        status: "active"
      },
      {
        id: "cloudflare_web_analytics",
        role: "実利用環境、ページ表示、Core Web Vitals",
        status: "not_configured"
      },
      {
        id: "google_search_console",
        role: "検索表示、検索クリック、検索語句",
        status: "not_configured"
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
  const eventFactsCutoff = addDays(new Date(`${today}T00:00:00.000Z`), -34)
    .toISOString()
    .slice(0, 10);
  const reportingCutoff = addDays(new Date(`${today}T00:00:00.000Z`), -399)
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
  const retentionFrom = addDays(new Date(`${today}T00:00:00.000Z`), -34)
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
    inclusiveDays > 35
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
