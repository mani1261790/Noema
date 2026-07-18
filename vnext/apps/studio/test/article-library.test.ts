import { describe, expect, it } from "vitest";
import type { CmsArticleSummary } from "@noema/cms";
import { filterCmsArticles } from "../src/article-library";

const articles: CmsArticleSummary[] = [
  {
    id: "article-newest",
    lockVersion: 4,
    publicationStatus: "published",
    revisionNumber: 4,
    reviewStatus: "draft",
    slug: "workers-ai-guide",
    title: "Workers AI ガイド",
    updatedAt: "2026-07-18T08:00:00.000Z",
    updatedByEmail: "Editor@Example.com",
    visibility: "public"
  },
  {
    id: "article-review",
    lockVersion: 2,
    publicationStatus: "unpublished",
    revisionNumber: 2,
    reviewStatus: "in_review",
    slug: "review-flow",
    title: "レビューの進め方",
    updatedAt: "2026-07-17T08:00:00.000Z",
    updatedByEmail: "reviewer@example.com",
    visibility: "internal"
  },
  {
    id: "article-archived",
    lockVersion: 1,
    publicationStatus: "archived",
    revisionNumber: 1,
    reviewStatus: "approved",
    slug: "legacy-note",
    title: "過去のお知らせ",
    updatedAt: "2026-07-16T08:00:00.000Z",
    updatedByEmail: "admin@example.com",
    visibility: "unlisted"
  }
];

describe("filterCmsArticles", () => {
  it("searches title, slug, and editor without changing the source order", () => {
    expect(filterCmsArticles(articles, "  WORKERS-AI  ", "all").map((article) => article.id))
      .toEqual(["article-newest"]);
    expect(filterCmsArticles(articles, "レビュー", "all").map((article) => article.id))
      .toEqual(["article-review"]);
    expect(filterCmsArticles(articles, "EDITOR@EXAMPLE.COM", "all").map((article) => article.id))
      .toEqual(["article-newest"]);
    expect(filterCmsArticles(articles, "", "all").map((article) => article.id))
      .toEqual(["article-newest", "article-review", "article-archived"]);
  });

  it("filters articles by editorial and publication state", () => {
    expect(filterCmsArticles(articles, "", "draft").map((article) => article.id))
      .toEqual(["article-newest"]);
    expect(filterCmsArticles(articles, "", "review").map((article) => article.id))
      .toEqual(["article-review", "article-archived"]);
    expect(filterCmsArticles(articles, "", "published").map((article) => article.id))
      .toEqual(["article-newest"]);
    expect(filterCmsArticles(articles, "", "archived").map((article) => article.id))
      .toEqual(["article-archived"]);
  });

  it("combines a status filter with normalized search text", () => {
    expect(filterCmsArticles(articles, "　ＡＤＭＩＮ＠ＥＸＡＭＰＬＥ．ＣＯＭ　", "archived")
      .map((article) => article.id)).toEqual(["article-archived"]);
    expect(filterCmsArticles(articles, "reviewer", "published")).toEqual([]);
  });
});
