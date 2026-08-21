import { describe, expect, it } from "vitest";
import {
  canCms,
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
    expect(canCms("admin", "manage_members")).toBe(true);
  });

  it("requires optimistic concurrency for workflow actions", () => {
    expect(cmsArticleActionSchema.safeParse({
      action: "publish",
      expectedVersion: 3,
      visibility: "public"
    }).success).toBe(true);
    expect(cmsArticleActionSchema.safeParse({ action: "publish" }).success)
      .toBe(false);
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
});
