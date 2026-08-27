import { z } from "zod";

export const cmsAnalyticsEventTypeSchema = z.enum([
  "landing",
  "article_50",
  "article_end",
  "navigation_click",
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
export type CmsAnalyticsEventRequest = z.infer<typeof cmsAnalyticsEventRequestSchema>;
export type CmsAnalyticsDays = z.infer<typeof cmsAnalyticsDaysSchema>;
export type CmsAnalyticsRebuildRequest = z.infer<typeof cmsAnalyticsRebuildRequestSchema>;

export interface CmsAnalyticsRebuildResult extends CmsAnalyticsRebuildRequest {
  completedAt: string;
  runId: string;
  sourceEventCount: number;
}

export const CMS_ANALYTICS_EVENT_CONTRACT_VERSION = 1 as const;
export const CMS_ANALYTICS_METRIC_CATALOG_VERSION = "2026-08-23" as const;

export interface CmsAnalyticsMetricDefinition {
  caveat: string;
  decision: string;
  denominator: CmsAnalyticsEventType;
  grain: "article_revision";
  id: "article_50_rate" | "qualified_read_rate" | "onward_rate" | "assistant_use_rate" | "assistant_success_rate";
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
    id: "noema_reader_events" | "cloudflare_web_analytics" | "google_search_console";
    role: string;
    status: "active" | "not_configured";
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
}

export interface CmsAnalyticsEntryMetric {
  article50: number;
  article50Rate: number | null;
  articleEnd: number;
  entryKind: CmsAnalyticsEntryKind | "unknown";
  landing: number;
  navigationClick: number;
  qualifiedReadRate: number | null;
}

export interface CmsAnalyticsDailyMetric {
  articleEnd: number;
  date: string;
  landing: number;
  navigationClick: number;
}

export interface CmsAnalyticsSummary {
  articles: CmsAnalyticsArticleMetric[];
  daily: CmsAnalyticsDailyMetric[];
  entries: CmsAnalyticsEntryMetric[];
  health: CmsAnalyticsHealth;
  range: {
    days: CmsAnalyticsDays;
    from: string;
    through: string;
  };
  sources: CmsAnalyticsSourceMetric[];
  totals: CmsAnalyticsCounts & {
    article50Rate: number | null;
    assistantSuccessRate: number | null;
    assistantUseRate: number | null;
    onwardRate: number | null;
    qualifiedReadRate: number | null;
  };
}
