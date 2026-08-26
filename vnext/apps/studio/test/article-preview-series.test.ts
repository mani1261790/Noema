import { describe, expect, it } from "vitest";
import type { CmsSeries } from "@noema/cms";
import { buildArticlePreviewSeries } from "../src/article-preview-series";

const series: CmsSeries = {
  articleIds: ["article-1", "article-2", "article-3"],
  articles: [
    { id: "article-1", publicationStatus: "published", reviewStatus: "approved", slug: "first", title: "第1回", visibility: "public" },
    { id: "article-2", publicationStatus: "unpublished", reviewStatus: "draft", slug: "second", title: "保存済みタイトル", visibility: "internal" },
    { id: "article-3", publicationStatus: "unpublished", reviewStatus: "draft", slug: "third", title: "第3回", visibility: "internal" },
  ],
  createdAt: "2026-08-22T00:00:00Z",
  description: "シリーズ説明",
  id: "series-1",
  lockVersion: 1,
  revisionNumber: 1,
  slug: "series",
  title: "シリーズ名",
  updatedAt: "2026-08-22T00:00:00Z",
  updatedByEmail: "editor@example.com",
};

describe("buildArticlePreviewSeries", () => {
  it("builds the complete series context and reflects the title being edited", () => {
    expect(buildArticlePreviewSeries("article-2", "編集中タイトル", [series])).toEqual({
      currentIndex: 1,
      description: "シリーズ説明",
      href: "/series/series",
      items: [
        { href: "/articles/first/", title: "第1回" },
        { href: "/articles/second/", title: "編集中タイトル" },
        { href: "/articles/third/", title: "第3回" },
      ],
      title: "シリーズ名",
    });
  });

  it("returns null for an unsaved or non-series article", () => {
    expect(buildArticlePreviewSeries(null, "未保存", [series])).toBeNull();
    expect(buildArticlePreviewSeries("not-in-series", "単独記事", [series])).toBeNull();
  });
});
