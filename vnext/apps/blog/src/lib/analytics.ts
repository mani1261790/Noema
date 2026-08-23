import type { CmsAnalyticsEventRequest } from "@noema/cms";

export interface CmsAnalyticsStatement {
  bind(...values: unknown[]): CmsAnalyticsStatement;
  first(): Promise<unknown | null>;
  run(): Promise<unknown>;
}

export interface CmsAnalyticsDatabase {
  prepare(query: string): CmsAnalyticsStatement;
}

export interface CmsAnalyticsDataset {
  writeDataPoint(event?: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

export interface CmsAnalyticsRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export function analyticsRateLimitKey(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export async function allowCmsAnalyticsEvent(
  limiter: CmsAnalyticsRateLimiter,
  request: Request
): Promise<boolean> {
  const outcome = await limiter.limit({ key: analyticsRateLimitKey(request) });
  return outcome.success;
}

interface PublishedArticleRow {
  id: string;
  published_revision_number: number;
  published_slug: string;
}

function isPublishedArticleRow(value: unknown): value is PublishedArticleRow {
  return Boolean(
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "published_revision_number" in value &&
    typeof value.published_revision_number === "number" &&
    Number.isInteger(value.published_revision_number) &&
    value.published_revision_number >= 1 &&
    "published_slug" in value &&
    typeof value.published_slug === "string"
  );
}

export interface RecordAnalyticsOptions {
  now?: Date;
}

/**
 * Dataset: noema_reader_events
 *
 * Blobs:
 *   1 event type, 2 article slug, 3 revision number, 4 source, 5 medium,
 *   6 campaign, 7 content, 8 referrer host, 9 navigation kind,
 *   10 target slug
 * Doubles:
 *   1 count (always 1)
 * Index:
 *   article ID, a bounded and immutable primary reporting subgroup
 */
export async function recordCmsAnalyticsEvent(
  db: CmsAnalyticsDatabase,
  dataset: CmsAnalyticsDataset,
  event: CmsAnalyticsEventRequest,
  options: RecordAnalyticsOptions = {}
): Promise<boolean> {
  const article = await db.prepare(
    `SELECT id, published_revision_number, published_slug
     FROM cms_articles
     WHERE publication_status = 'published'
       AND published_visibility IN ('public', 'unlisted')
       AND published_slug = ?1
     LIMIT 1`
  ).bind(event.articleSlug).first();
  if (!isPublishedArticleRow(article)) return false;

  const attribution = event.attribution ?? {};
  const source = attribution.source ?? "";
  const medium = attribution.medium ?? "";
  const campaign = attribution.campaign ?? "";
  const content = attribution.content ?? "";
  const referrerHost = attribution.referrerHost ?? "";
  const navigationKind = event.navigationKind ?? "";
  const targetSlug = event.targetSlug ?? "";
  const timestamp = (options.now ?? new Date()).toISOString();
  const eventDate = timestamp.slice(0, 10);

  await db.prepare(
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
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, ?13)
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
       event_count = cms_analytics_daily.event_count + excluded.event_count,
       article_slug = excluded.article_slug,
       updated_at = excluded.updated_at`
  ).bind(
    eventDate,
    article.id,
    article.published_slug,
    article.published_revision_number,
    event.eventType,
    source,
    medium,
    campaign,
    content,
    referrerHost,
    navigationKind,
    targetSlug,
    timestamp
  ).run();

  try {
    dataset.writeDataPoint({
      blobs: [
        event.eventType,
        article.published_slug,
        String(article.published_revision_number),
        source,
        medium,
        campaign,
        content,
        referrerHost,
        navigationKind,
        targetSlug
      ],
      doubles: [1],
      indexes: [article.id]
    });
  } catch (error) {
    // The D1 aggregate is canonical; exploratory Analytics Engine loss must not
    // make a successfully stored reader event look like a failed request.
    console.warn(JSON.stringify({
      event: "blog.analytics.exploratory_write_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
  }
  return true;
}
