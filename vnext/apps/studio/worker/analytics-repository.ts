import {
  canCms,
  type CmsAnalyticsArticleMetric,
  type CmsAnalyticsCounts,
  type CmsAnalyticsDailyMetric,
  type CmsAnalyticsDays,
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

  const [articleResult, sourceResult, dailyResult] = await Promise.all([
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
      `SELECT event_date, event_type, SUM(event_count) AS event_count
       FROM cms_analytics_daily
       WHERE event_date BETWEEN ?1 AND ?2
       GROUP BY event_date, event_type
       ORDER BY event_date ASC`
    ).bind(from, through).all<DailyEventRow>()
  ]);

  const articleMetrics = new Map<string, CmsAnalyticsArticleMetric>();
  for (const row of articleResult.results) {
    const key = `${row.article_id}:${row.revision_number}`;
    const metric = articleMetrics.get(key) ?? {
      ...emptyCounts(),
      articleId: row.article_id,
      assistantSuccessRate: null,
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
    assistantSuccessRate: ratio(metric.assistantSuccess, metric.assistantOpen),
    onwardRate: ratio(metric.navigationClick, metric.articleEnd),
    qualifiedReadRate: ratio(metric.articleEnd, metric.landing)
  })).sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);

  const sourceMetrics = new Map<string, CmsAnalyticsSourceMetric>();
  for (const row of sourceResult.results) {
    const key = [row.source, row.medium, row.campaign, row.content, row.referrer_host].join("\u0000");
    const metric = sourceMetrics.get(key) ?? {
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
    if (row.event_type === "article_end") metric.articleEnd += row.event_count;
    if (row.event_type === "navigation_click") metric.navigationClick += row.event_count;
    sourceMetrics.set(key, metric);
  }
  const sources = [...sourceMetrics.values()]
    .filter((metric) => metric.landing > 0 || metric.articleEnd > 0 || metric.navigationClick > 0)
    .map((metric) => ({
      ...metric,
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

  return {
    articles,
    daily: [...dailyByDate.values()],
    range: { days, from, through },
    sources,
    totals: {
      ...totals,
      assistantSuccessRate: ratio(totals.assistantSuccess, totals.assistantOpen),
      onwardRate: ratio(totals.navigationClick, totals.articleEnd),
      qualifiedReadRate: ratio(totals.articleEnd, totals.landing)
    }
  };
}
