import { z } from "zod";

export const cmsAnalyticsEventTypeSchema = z.enum([
  "landing",
  "article_50",
  "article_end",
  "navigation_click",
  "updates_click",
  "updates_action",
  "share",
  "assistant_open",
  "assistant_success",
  "assistant_error"
]);

export const cmsAnalyticsNavigationKindSchema = z.enum([
  "series_next",
  "related"
]);

export const cmsAnalyticsEntryKindSchema = z.enum([
  "direct",
  "external",
  "home",
  "article_index",
  "series",
  "topic",
  "article",
  "other_internal"
]);

export const cmsAnalyticsAcquisitionChannelSchema = z.enum([
  "direct",
  "organic_search",
  "campaign",
  "referral"
]);

const analyticsIdentifierSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const analyticsCampaignValueSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const articleSlugSchema = z.string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const referrerHostSchema = z.string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

export const cmsAnalyticsAttributionSchema = z.object({
  campaign: analyticsCampaignValueSchema.optional(),
  content: analyticsCampaignValueSchema.optional(),
  medium: analyticsIdentifierSchema.optional(),
  referrerHost: referrerHostSchema.optional(),
  source: analyticsIdentifierSchema.optional()
}).strict();

export const cmsAnalyticsEventRequestSchema = z.object({
  articleSlug: articleSlugSchema,
  attribution: cmsAnalyticsAttributionSchema.optional(),
  entryKind: cmsAnalyticsEntryKindSchema.optional(),
  eventId: z.uuid(),
  eventType: cmsAnalyticsEventTypeSchema,
  navigationKind: cmsAnalyticsNavigationKindSchema.optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  schemaVersion: z.literal(1),
  targetSlug: articleSlugSchema.optional()
}).strict().superRefine((value, context) => {
  const navigationEvent = value.eventType === "navigation_click";
  if (navigationEvent && !value.navigationKind) {
    context.addIssue({
      code: "custom",
      message: "navigationKind is required for navigation events.",
      path: ["navigationKind"]
    });
  }
  if (navigationEvent && !value.targetSlug) {
    context.addIssue({
      code: "custom",
      message: "targetSlug is required for navigation events.",
      path: ["targetSlug"]
    });
  }
  if (!navigationEvent && (value.navigationKind || value.targetSlug)) {
    context.addIssue({
      code: "custom",
      message: "Navigation fields are only accepted for navigation events.",
      path: ["navigationKind"]
    });
  }
});

export const cmsAnalyticsDaysSchema = z.union([
  z.literal(7),
  z.literal(30),
  z.literal(90)
]);

const analyticsDateSchema = z.iso.date();
export const cmsAnalyticsRebuildRequestSchema = z.object({
  from: analyticsDateSchema,
  through: analyticsDateSchema
}).strict();

export type CmsAnalyticsEventType = z.infer<typeof cmsAnalyticsEventTypeSchema>;
export type CmsAnalyticsEntryKind = z.infer<typeof cmsAnalyticsEntryKindSchema>;
export type CmsAnalyticsNavigationKind = z.infer<typeof cmsAnalyticsNavigationKindSchema>;
export type CmsAnalyticsAcquisitionChannel = z.infer<typeof cmsAnalyticsAcquisitionChannelSchema>;
export type CmsAnalyticsAttribution = z.infer<typeof cmsAnalyticsAttributionSchema>;
export type CmsAnalyticsEventRequest = z.infer<typeof cmsAnalyticsEventRequestSchema>;
export type CmsAnalyticsDays = z.infer<typeof cmsAnalyticsDaysSchema>;
export type CmsAnalyticsRebuildRequest = z.infer<typeof cmsAnalyticsRebuildRequestSchema>;

const searchEngineHosts = new Set([
  "baidu.com",
  "bing.com",
  "duckduckgo.com",
  "ecosia.org",
  "search.brave.com",
  "search.naver.com",
  "search.yahoo.co.jp",
  "yandex.com",
  "yandex.ru"
]);

function isSearchEngineReferrerHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/^www\./u, "");
  return /^google\.[a-z]{2,3}(?:\.[a-z]{2})?$/u.test(host) || searchEngineHosts.has(host);
}

/**
 * Derives a bounded acquisition channel from already-stored attribution.
 * Explicit UTM tagging wins over the referrer, except medium=organic.
 */
export function classifyCmsAnalyticsAcquisitionChannel(
  attribution: CmsAnalyticsAttribution
): CmsAnalyticsAcquisitionChannel {
  const source = attribution.source?.trim().toLowerCase() ?? "";
  const medium = attribution.medium?.trim().toLowerCase() ?? "";
  const campaign = attribution.campaign?.trim().toLowerCase() ?? "";
  const content = attribution.content?.trim().toLowerCase() ?? "";
  const referrerHost = attribution.referrerHost?.trim().toLowerCase() ?? "";
  const hasCampaignAttribution = Boolean(source || medium || campaign || content);
  if (hasCampaignAttribution) return medium === "organic" ? "organic_search" : "campaign";
  if (isSearchEngineReferrerHost(referrerHost)) return "organic_search";
  return referrerHost ? "referral" : "direct";
}

export interface CmsAnalyticsRebuildResult extends CmsAnalyticsRebuildRequest {
  completedAt: string;
  runId: string;
  sourceEventCount: number;
}

export const CMS_ANALYTICS_EVENT_CONTRACT_VERSION = 1 as const;
export const CMS_ANALYTICS_ACQUISITION_CHANNEL_VERSION = 1 as const;
export const CMS_ANALYTICS_METRIC_CATALOG_VERSION = "2026-08-28" as const;
export const CMS_ANALYTICS_EVENT_FACT_RETENTION_DAYS = 35 as const;
export const CMS_ANALYTICS_REPORTING_MART_RETENTION_DAYS = 400 as const;
export const CMS_CLOUDFLARE_WEB_ANALYTICS_URL =
  "https://dash.cloudflare.com/2ea670c2a6ff28e248ef084adf095e8b/web-analytics/overview?siteTag~in=5f20b6bdc0224ec3ba4604aadb43376a&excludeBots=Yes" as const;
export const CMS_GOOGLE_SEARCH_CONSOLE_URL =
  "https://search.google.com/search-console/performance/search-analytics?resource_id=https%3A%2F%2Fnoema-learn.uk%2F" as const;
export const CMS_GOOGLE_SEARCH_CONSOLE_INDEX_URL =
  "https://search.google.com/search-console/index?resource_id=https%3A%2F%2Fnoema-learn.uk%2F" as const;
export const CMS_GOOGLE_SEARCH_CONSOLE_SITEMAPS_URL =
  "https://search.google.com/search-console/sitemaps?resource_id=https%3A%2F%2Fnoema-learn.uk%2F" as const;
export const CMS_GOOGLE_SEARCH_CONSOLE_LINKS_URL =
  "https://search.google.com/search-console/links?resource_id=https%3A%2F%2Fnoema-learn.uk%2F" as const;

export interface CmsAnalyticsMetricDefinition {
  caveat: string;
  decision: string;
  denominator: CmsAnalyticsEventType;
  grain: "article_revision";
  id: "article_50_rate" | "qualified_read_rate" | "onward_rate" | "updates_guide_rate" | "updates_action_rate" | "assistant_use_rate" | "assistant_success_rate";
  label: string;
  numerator: CmsAnalyticsEventType;
  owner: "editorial";
  source: "cms_analytics_daily";
  version: 1;
}

/** Canonical KPI dictionary. UI labels must not redefine these formulas. */
export const cmsAnalyticsMetricCatalog = [
  {
    caveat: "ページ表示ベースであり、ユニーク読者率ではありません。",
    decision: "流入時の約束と記事前半の構成を見直す判断に使います。",
    denominator: "landing",
    grain: "article_revision",
    id: "article_50_rate",
    label: "50%到達率",
    numerator: "article_50",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "本文末尾の表示であり、内容理解の直接測定ではありません。",
    decision: "記事の長さ、構成、説明の途切れを見直す判断に使います。",
    denominator: "landing",
    grain: "article_revision",
    id: "qualified_read_rate",
    label: "読了率",
    numerator: "article_end",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "読了イベントとクリックイベントを読者単位には結合しません。",
    decision: "シリーズ導線と記事末尾CTAを見直す判断に使います。",
    denominator: "article_end",
    grain: "article_revision",
    id: "onward_rate",
    label: "次記事移動率",
    numerator: "navigation_click",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "更新案内ページへのクリックであり、RSS購読の完了や継続利用を直接測るものではありません。",
    decision: "記事末の更新導線の発見性と説明を見直す判断に使います。",
    denominator: "article_end",
    grain: "article_revision",
    id: "updates_guide_rate",
    label: "更新案内クリック率",
    numerator: "updates_click",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "更新案内ページでの最初のコピー成功またはフィードリンクのクリックです。購読完了や継続利用を測らず、イベントを読者単位にも結合しません。",
    decision: "更新案内ページの説明とRSS追加手順を見直す判断に使います。",
    denominator: "updates_click",
    grain: "article_revision",
    id: "updates_action_rate",
    label: "RSS行動率",
    numerator: "updates_action",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "質問内容や読者IDは保存しないため、利用者属性は分析できません。",
    decision: "記事内アシスタントの発見性と必要性を見直す判断に使います。",
    denominator: "landing",
    grain: "article_revision",
    id: "assistant_use_rate",
    label: "アシスタント利用率",
    numerator: "assistant_open",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  },
  {
    caveat: "回答表示の成功であり、回答品質や問題解決を直接保証しません。",
    decision: "アシスタント実行経路の技術的な失敗を調べる判断に使います。",
    denominator: "assistant_open",
    grain: "article_revision",
    id: "assistant_success_rate",
    label: "アシスタント成功率",
    numerator: "assistant_success",
    owner: "editorial",
    source: "cms_analytics_daily",
    version: 1
  }
] as const satisfies readonly CmsAnalyticsMetricDefinition[];

export type CmsAnalyticsQualityCheckStatus = "pass" | "warn" | "not_evaluated";
export type CmsAnalyticsQualityStatus = "healthy" | "attention" | "collecting" | "no_data";

export interface CmsAnalyticsQualityCheck {
  detail: string;
  id: "freshness" | "duplicate_rate" | "contract_conformance" | "revision_lineage" | "mart_reconciliation" | "funnel_consistency";
  label: string;
  status: CmsAnalyticsQualityCheckStatus;
}

export interface CmsAnalyticsHealth {
  acceptedEvents: number;
  acquisitionChannelVersion: typeof CMS_ANALYTICS_ACQUISITION_CHANNEL_VERSION;
  checks: CmsAnalyticsQualityCheck[];
  duplicateEvents: number;
  entryCoverageFrom: string;
  eventContractVersion: typeof CMS_ANALYTICS_EVENT_CONTRACT_VERSION;
  generatedAt: string;
  latestEventReceivedAt: string | null;
  metricCatalogVersion: string;
  rawCoverageFrom: string;
  reprocessableFrom: string;
  retention: {
    eventFactsDays: number;
    reportingMartDays: number;
  };
  sources: Array<{
    accessUrl?: string;
    id: "noema_reader_events" | "cloudflare_web_analytics" | "google_search_console";
    role: string;
    status: "active" | "external" | "not_configured";
  }>;
  status: CmsAnalyticsQualityStatus;
}

export interface CmsAnalyticsCounts {
  article50: number;
  articleEnd: number;
  assistantError: number;
  assistantOpen: number;
  assistantSuccess: number;
  landing: number;
  navigationClick: number;
  relatedClick: number;
  seriesNext: number;
  share: number;
  updatesAction: number;
  updatesClick: number;
}

export interface CmsAnalyticsTotals extends CmsAnalyticsCounts {
  article50Rate: number | null;
  assistantSuccessRate: number | null;
  assistantUseRate: number | null;
  onwardRate: number | null;
  qualifiedReadRate: number | null;
  updatesActionRate: number | null;
  updatesGuideRate: number | null;
}

export interface CmsAnalyticsComparison {
  availableOn: string;
  range: {
    from: string;
    through: string;
  };
  status: "available" | "collecting";
  totals: CmsAnalyticsTotals | null;
}

export interface CmsAnalyticsArticleMetric extends CmsAnalyticsCounts {
  articleId: string;
  article50Rate: number | null;
  assistantSuccessRate: number | null;
  assistantUseRate: number | null;
  onwardRate: number | null;
  qualifiedReadRate: number | null;
  revisionNumber: number;
  slug: string;
  title: string;
  updatesActionRate: number | null;
  updatesGuideRate: number | null;
}

export interface CmsAnalyticsOnwardPath {
  clickCount: number;
  navigationKind: CmsAnalyticsNavigationKind;
  sourceArticleId: string;
  sourceRevisionNumber: number;
  sourceSlug: string;
  sourceTitle: string;
  targetSlug: string;
  targetTitle: string;
}

export interface CmsAnalyticsSourceMetric {
  article50: number;
  article50Rate: number | null;
  articleEnd: number;
  campaign: string;
  content: string;
  landing: number;
  medium: string;
  navigationClick: number;
  qualifiedReadRate: number | null;
  referrerHost: string;
  source: string;
  updatesClick: number;
  updatesGuideRate: number | null;
}

export interface CmsAnalyticsAcquisitionMetric {
  article50: number;
  article50Rate: number | null;
  articleEnd: number;
  channel: CmsAnalyticsAcquisitionChannel;
  landing: number;
  navigationClick: number;
  onwardRate: number | null;
  qualifiedReadRate: number | null;
}

export interface CmsAnalyticsOrganicArticleMetric extends Omit<CmsAnalyticsAcquisitionMetric, "channel"> {
  articleId: string;
  revisionNumber: number;
  slug: string;
  title: string;
}

export interface CmsAnalyticsEntryMetric {
  article50: number;
  article50Rate: number | null;
  articleEnd: number;
  entryKind: CmsAnalyticsEntryKind | "unknown";
  landing: number;
  navigationClick: number;
  qualifiedReadRate: number | null;
  updatesClick: number;
  updatesGuideRate: number | null;
}

export interface CmsAnalyticsDailyMetric {
  articleEnd: number;
  date: string;
  landing: number;
  navigationClick: number;
  updatesAction: number;
  updatesClick: number;
}

export interface CmsAnalyticsSummary {
  acquisitionChannels: CmsAnalyticsAcquisitionMetric[];
  articles: CmsAnalyticsArticleMetric[];
  comparison: CmsAnalyticsComparison;
  daily: CmsAnalyticsDailyMetric[];
  entries: CmsAnalyticsEntryMetric[];
  health: CmsAnalyticsHealth;
  onwardPaths: CmsAnalyticsOnwardPath[];
  onwardPathsTruncated: boolean;
  organicSearchArticles: CmsAnalyticsOrganicArticleMetric[];
  range: {
    days: CmsAnalyticsDays;
    from: string;
    through: string;
  };
  sources: CmsAnalyticsSourceMetric[];
  totals: CmsAnalyticsTotals;
}
