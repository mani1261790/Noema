import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsArticleSeriesEditor, suggestSeriesSlug } from "../src/CmsArticleSeriesEditor";

const article = {
  id: "11111111-1111-4111-8111-111111111111",
  lockVersion: 2,
  publicationStatus: "published" as const,
  revisionNumber: 2,
  reviewStatus: "draft" as const,
  slug: "series-first",
  title: "シリーズ最初の記事",
  updatedAt: "2026-08-21T00:00:00.000Z",
  updatedByEmail: "editor@example.com",
  visibility: "public" as const
};

const existing = {
  articleIds: [] as string[],
  articles: [],
  createdAt: "2026-08-21T00:00:00.000Z",
  description: "順番に学ぶシリーズです。",
  id: "22222222-2222-4222-8222-222222222222",
  lockVersion: 1,
  revisionNumber: 1,
  slug: "learning-series",
  title: "学習シリーズ",
  updatedAt: "2026-08-21T00:00:00.000Z",
  updatedByEmail: "editor@example.com"
};

const props: ComponentProps<typeof CmsArticleSeriesEditor> = {
  articleId: article.id,
  articles: [article],
  busy: false,
  canEdit: true,
  error: null,
  onLoadVersions: async () => [],
  onSave: async () => null,
  series: [existing]
};

describe("CmsArticleSeriesEditor", () => {
  it("lets an editor add the current article or create a series without leaving article settings", () => {
    const html = renderToStaticMarkup(createElement(CmsArticleSeriesEditor, props));

    expect(html).toContain("未設定です");
    expect(html).toContain("既存シリーズ");
    expect(html).toContain("このシリーズへ追加");
    expect(html).toContain("新しいシリーズを作る");
    expect(html).toContain("シリーズを作成して追加");
  });

  it("shows position, ordering controls, and history for an existing membership", () => {
    const memberSeries = { ...existing, articleIds: [article.id], articles: [article] };
    const html = renderToStaticMarkup(createElement(CmsArticleSeriesEditor, {
      ...props,
      series: [memberSeries]
    }));

    expect(html).toContain("学習シリーズ");
    expect(html).toContain("第1回 / 全1回");
    expect(html).toContain("履歴と復元");
    expect(html).toContain("シリーズ情報を編集");
    expect(html).toContain("シリーズを保存");
    expect(html).toContain("この記事をシリーズから外す");
    expect(html).toContain("最後の記事は外せません");
  });

  it("generates stable URLs for both Latin and Japanese titles", () => {
    expect(suggestSeriesSlug("Workers AI 入門")).toBe("workers-ai");
    expect(suggestSeriesSlug("はじめての記事体系")).toMatch(/^series-[a-z0-9]{6}$/u);
    expect(suggestSeriesSlug("はじめての記事体系")).toBe(suggestSeriesSlug("はじめての記事体系"));
  });
});
