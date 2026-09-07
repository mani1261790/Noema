import { describe, expect, it } from "vitest";
import type { CmsArticleSummary, CmsSeries } from "@noema/cms";
import { cmsAllArticleFilter, cmsUnpublishedArticleFilter, filterCmsArticles, getCmsArticleStatus, groupCmsArticles, sortCmsArticles } from "../src/article-library";

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

describe("article library", () => {
  const source: CmsArticleSummary[] = [
    ...articles,
    { ...articles[1], id: "fix", reviewStatus: "changes_requested" },
    { ...articles[1], id: "ready", reviewStatus: "approved" },
    { ...articles[1], id: "draft", reviewStatus: "draft" }
  ];

  it("searches normalized titles, URLs, editors and series names", () => {
    expect(filterCmsArticles(source, "　ＷＯＲＫＥＲＳ－ＡＩ　", cmsAllArticleFilter).map(({ id }) => id)).toEqual(["article-newest"]);
    expect(filterCmsArticles(source, "EDITOR@EXAMPLE.COM", cmsAllArticleFilter).map(({ id }) => id)).toEqual(["article-newest"]);
    expect(filterCmsArticles(source, "入門", cmsAllArticleFilter, new Map([["fix", "Cloudflare入門"]])).map(({ id }) => id)).toEqual(["fix"]);
  });

  it("classifies live revisions as published and requested changes as drafts", () => {
    for (const reviewStatus of ["draft", "changes_requested", "in_review", "approved"] as const) {
      expect(getCmsArticleStatus({ ...articles[0], reviewStatus })).toBe("published");
    }
    expect(getCmsArticleStatus(source[3])).toBe("draft");
  });

  it("combines statuses with OR, search with AND, and no selection shows no articles", () => {
    const filter = { statuses: ["draft", "approved"] as const, includeArchived: false };
    expect(filterCmsArticles(source, "", filter).map(({ id }) => id)).toEqual(["fix", "ready", "draft"]);
    expect(filterCmsArticles(source, "does not exist", filter)).toEqual([]);
    expect(filterCmsArticles(source, "", { statuses: [], includeArchived: true })).toEqual([]);
  });

  it("selects only unpublished articles and keeps archives accessible separately", () => {
    expect(filterCmsArticles(source, "", cmsUnpublishedArticleFilter).map(({ id }) => id)).toEqual(["article-review", "fix", "ready", "draft"]);
    expect(filterCmsArticles(source, "", cmsAllArticleFilter)).toEqual(source);
    expect(filterCmsArticles(source, "", { statuses: ["approved"], includeArchived: true }).map(({ id }) => id)).toEqual(["article-archived", "ready"]);
  });

  it("sorts Japanese titles and embedded numbers without mutating input", () => {
    const input = [
      { ...articles[0], id: "ten", title: "入門10", updatedAt: "2026-07-01T00:00:00Z" },
      { ...articles[0], id: "two", title: "入門2", updatedAt: "2026-07-03T00:00:00Z" },
      { ...articles[0], id: "one", title: "入門1", updatedAt: "2026-07-02T00:00:00Z" }
    ];
    expect(sortCmsArticles(input, "title").map(({ id }) => id)).toEqual(["one", "two", "ten"]);
    expect(sortCmsArticles(input, "updated").map(({ id }) => id)).toEqual(["two", "one", "ten"]);
    expect(input.map(({ id }) => id)).toEqual(["ten", "two", "one"]);
  });

  it("groups only matching articles, preserves series order and retains standalone articles", () => {
    const series = [
      { id: "b", title: "入門2", articleIds: ["fix", "article-newest", "missing"] },
      { id: "a", title: "入門1", articleIds: ["ready"] },
      { id: "empty", title: "対象なし", articleIds: ["missing"] }
    ] as CmsSeries[];
    const result = groupCmsArticles(source, series, "updated");
    expect(result.groups.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(result.groups[0].articles.map(({ id }) => id)).toEqual(["fix", "article-newest"]);
    expect(result.groups[0].total).toBe(3);
    expect(result.standalone.map(({ id }) => id)).toEqual(["article-review", "draft", "article-archived"]);
    expect(groupCmsArticles(source, series, "title").groups.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(groupCmsArticles([source[3]], series, "updated").groups[0].articles.map(({ id }) => id)).toEqual(["fix"]);
  });
});
