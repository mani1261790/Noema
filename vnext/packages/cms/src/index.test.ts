import { describe, expect, it } from "vitest";
import {
  canCms,
  classifyCmsAnalyticsAcquisitionChannel,
  cmsAnalyticsMetricCatalog,
  cmsAnalyticsEventRequestSchema,
  cmsAnalyticsRebuildRequestSchema,
  cmsArticleActionSchema,
  cmsDraftFrontmatterSchema,
  cmsSeriesContentSchema,
  validateCmsArticleForReview
} from "./index";

describe("CMS contracts", () => {
  it("allows incomplete drafts but rejects them at review", () => {
    const frontmatter = {
      title: "",
      description: "",
      slug: "",
      status: "draft" as const,
      updatedAt: "2026-07-18",
      authors: [],
      topics: [],
      tags: [],
      approach: "experience" as const,
      outcome: "",
      prerequisites: [],
      estimatedMinutes: 0,
      heroImage: null,
      sources: []
    };

    expect(cmsDraftFrontmatterSchema.safeParse(frontmatter).success).toBe(true);
    expect(validateCmsArticleForReview({ frontmatter, markdown: "" }).length)
      .toBeGreaterThan(0);
  });

  it("keeps editorial and approval permissions separate", () => {
    expect(canCms("editor", "edit")).toBe(true);
    expect(canCms("editor", "approve")).toBe(false);
    expect(canCms("reviewer", "approve")).toBe(true);
    expect(canCms("reviewer", "edit")).toBe(false);
    expect(canCms("reviewer", "comment")).toBe(true);
    expect(canCms("admin", "manage_members")).toBe(true);
  });

  it("requires an actionable reason when changes are requested", () => {
    expect(cmsArticleActionSchema.safeParse({
      action: "request_changes",
      expectedVersion: 3,
      note: "見出しの根拠を追記してください。"
    }).success).toBe(true);
    expect(cmsArticleActionSchema.safeParse({
      action: "request_changes",
      expectedVersion: 3
    }).success).toBe(false);
  });

  it("requires optimistic concurrency for workflow actions", () => {
    expect(cmsArticleActionSchema.safeParse({
      action: "publish",
      expectedVersion: 3,
      visibility: "public"
    }).success).toBe(true);
    expect(cmsArticleActionSchema.safeParse({ action: "publish" }).success)
      .toBe(false);
    expect(cmsArticleActionSchema.safeParse({
      action: "revoke_approval",
      expectedVersion: 4
    }).success).toBe(true);
  });

  it("requires a valid, uniquely ordered article list for a series", () => {
    const series = {
      articleIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      ],
      description: "基礎から順に学ぶシリーズです。",
      slug: "getting-started",
      title: "はじめてのNoema"
    };

    expect(cmsSeriesContentSchema.safeParse(series).success).toBe(true);
    expect(cmsSeriesContentSchema.safeParse({
      ...series,
      articleIds: [series.articleIds[0], series.articleIds[0]]
    }).success).toBe(false);
    expect(cmsSeriesContentSchema.safeParse({ ...series, slug: "Getting Started" }).success)
      .toBe(false);
  });

  it("accepts only bounded, content-free analytics dimensions", () => {
    const envelope = {
      eventId: "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e",
      occurredAt: "2026-08-23T01:02:03.000Z",
      schemaVersion: 1
    };
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      attribution: {
        campaign: "ollama_series",
        content: "memory_chart",
        medium: "social",
        referrerHost: "example.com",
        source: "x"
      },
      entryKind: "home",
      eventType: "article_end"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      entryKind: "article_search",
      eventType: "landing"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      entryKind: "article_search",
      eventType: "landing",
      keyword: "Codex"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "navigation_click",
      navigationKind: "related",
      targetSlug: "quantization-basics"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "navigation_click"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "discovery_click",
      navigationKind: "topic"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "discovery_click",
      navigationKind: "related"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "discovery_click",
      navigationKind: "article_index",
      targetSlug: "not-an-article"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "updates_click"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "updates_action"
    }).success).toBe(true);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      eventType: "updates_click",
      navigationKind: "related",
      targetSlug: "quantization-basics"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      attribution: { campaign: "質問本文を保存しない" },
      eventType: "landing"
    }).success).toBe(false);
    expect(cmsAnalyticsEventRequestSchema.safeParse({
      ...envelope,
      articleSlug: "local-ai-on-mac",
      entryKind: "/private/campaign/path",
      eventType: "landing"
    }).success).toBe(false);
  });

  it("classifies acquisition without storing search terms or reader identifiers", () => {
    expect(classifyCmsAnalyticsAcquisitionChannel({ referrerHost: "www.google.co.jp" }))
      .toBe("organic_search");
    expect(classifyCmsAnalyticsAcquisitionChannel({ referrerHost: "search.brave.com" }))
      .toBe("organic_search");
    expect(classifyCmsAnalyticsAcquisitionChannel({ referrerHost: "search.yahoo.com" }))
      .toBe("organic_search");
    expect(classifyCmsAnalyticsAcquisitionChannel({
      medium: "organic",
      referrerHost: "example.com",
      source: "google"
    })).toBe("organic_search");
    expect(classifyCmsAnalyticsAcquisitionChannel({
      medium: "cpc",
      referrerHost: "www.google.com",
      source: "google"
    })).toBe("campaign");
    expect(classifyCmsAnalyticsAcquisitionChannel({ referrerHost: "example.com" }))
      .toBe("referral");
    expect(classifyCmsAnalyticsAcquisitionChannel({})).toBe("direct");
  });

  it("defines discovery and update clicks without claiming downstream outcomes", () => {
    expect(cmsAnalyticsMetricCatalog).toContainEqual(expect.objectContaining({
      denominator: "article_end",
      id: "discovery_rate",
      numerator: "discovery_click"
    }));
    expect(cmsAnalyticsMetricCatalog.find((metric) => metric.id === "discovery_rate")?.caveat)
      .toContain("別の記事を読んだことまでは測りません");
    expect(cmsAnalyticsMetricCatalog).toContainEqual(expect.objectContaining({
      denominator: "article_end",
      id: "updates_guide_rate",
      numerator: "updates_click"
    }));
    expect(cmsAnalyticsMetricCatalog.find((metric) => metric.id === "updates_guide_rate")?.caveat)
      .toContain("RSS購読の完了");
    expect(cmsAnalyticsMetricCatalog).toContainEqual(expect.objectContaining({
      denominator: "updates_click",
      id: "updates_action_rate",
      numerator: "updates_action"
    }));
    expect(cmsAnalyticsMetricCatalog.find((metric) => metric.id === "updates_action_rate")?.caveat)
      .toContain("購読完了");
  });

  it("rejects impossible analytics rebuild calendar dates", () => {
    expect(cmsAnalyticsRebuildRequestSchema.safeParse({
      from: "2026-02-31",
      through: "2026-03-01"
    }).success).toBe(false);
  });
});
