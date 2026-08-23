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
  eventType: cmsAnalyticsEventTypeSchema,
  navigationKind: cmsAnalyticsNavigationKindSchema.optional(),
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

export type CmsAnalyticsEventType = z.infer<typeof cmsAnalyticsEventTypeSchema>;
export type CmsAnalyticsNavigationKind = z.infer<typeof cmsAnalyticsNavigationKindSchema>;
export type CmsAnalyticsEventRequest = z.infer<typeof cmsAnalyticsEventRequestSchema>;
export type CmsAnalyticsDays = z.infer<typeof cmsAnalyticsDaysSchema>;

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
  assistantSuccessRate: number | null;
  onwardRate: number | null;
  qualifiedReadRate: number | null;
  revisionNumber: number;
  slug: string;
  title: string;
}

export interface CmsAnalyticsSourceMetric {
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

export interface CmsAnalyticsDailyMetric {
  articleEnd: number;
  date: string;
  landing: number;
  navigationClick: number;
}

export interface CmsAnalyticsSummary {
  articles: CmsAnalyticsArticleMetric[];
  daily: CmsAnalyticsDailyMetric[];
  range: {
    days: CmsAnalyticsDays;
    from: string;
    through: string;
  };
  sources: CmsAnalyticsSourceMetric[];
  totals: CmsAnalyticsCounts & {
    assistantSuccessRate: number | null;
    onwardRate: number | null;
    qualifiedReadRate: number | null;
  };
}
