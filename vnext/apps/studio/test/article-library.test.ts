import { describe, expect, it } from "vitest";
import type { CmsArticleSummary } from "@noema/cms";
import { filterCmsArticles, getCmsEditorialQueue } from "../src/article-library";

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

  it("builds a role-specific queue without mixing review and publication work", () => {
    const readyToPublish: CmsArticleSummary = {
      ...articles[1],
      id: "article-publish",
      publicationStatus: "unpublished",
      reviewStatus: "approved"
    };
    const changesRequested: CmsArticleSummary = {
      ...articles[1],
      id: "article-fix",
      reviewStatus: "changes_requested"
    };
    const source = [...articles, readyToPublish, changesRequested];

    expect(getCmsEditorialQueue(source, "editor")).toEqual([
      expect.objectContaining({ count: 1, filter: "changes_requested", label: "修正する記事" })
    ]);
    expect(getCmsEditorialQueue(source, "reviewer")).toEqual([
      expect.objectContaining({ count: 1, filter: "in_review", label: "レビューする記事" })
    ]);
    expect(getCmsEditorialQueue(source, "admin")).toEqual([
      expect.objectContaining({ count: 1, filter: "in_review", label: "レビューする記事" }),
      expect.objectContaining({ count: 1, filter: "ready_to_publish", label: "公開する記事" })
    ]);
  });

  it("applies the precise queue filters", () => {
    const source: CmsArticleSummary[] = [
      ...articles,
      { ...articles[1], id: "article-fix", reviewStatus: "changes_requested" },
      { ...articles[1], id: "article-publish", reviewStatus: "approved", publicationStatus: "unpublished" }
    ];

    expect(filterCmsArticles(source, "", "changes_requested").map(({ id }) => id)).toEqual(["article-fix"]);
    expect(filterCmsArticles(source, "", "in_review").map(({ id }) => id)).toEqual(["article-review"]);
    expect(filterCmsArticles(source, "", "ready_to_publish").map(({ id }) => id)).toEqual(["article-publish"]);
  });
});
