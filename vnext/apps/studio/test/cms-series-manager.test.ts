import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsSeriesManager } from "../src/CmsSeriesManager";

const article = {
  id: "11111111-1111-4111-8111-111111111111",
  lockVersion: 2,
  publicationStatus: "published" as const,
  revisionNumber: 2,
  reviewStatus: "approved" as const,
  slug: "series-first",
  title: "シリーズ最初の記事",
  updatedAt: "2026-08-21T00:00:00.000Z",
  updatedByEmail: "editor@example.com",
  visibility: "public" as const
};

const existing = {
  articleIds: [article.id],
  articles: [article],
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

const props: ComponentProps<typeof CmsSeriesManager> = {
  articles: [article],
  busy: false,
  canEdit: true,
  connection: { email: "editor@example.com", kind: "ready", role: "editor" },
  error: null,
  onLoadVersions: async () => [],
  onRetry: () => undefined,
  onSave: async () => null,
  series: [existing]
};

describe("CmsSeriesManager", () => {
  it("uses labeled controls and preserves keyboard reordering alongside drag", () => {
    const html = renderToStaticMarkup(createElement(CmsSeriesManager, props));

    expect(html).toContain("シリーズ（体系）");
    expect(html).toContain("新しいシリーズ");
    expect(html).toContain("記事の順番");
    expect(html).toContain("ドラッグ、または「上へ」「下へ」");
    expect(html).toContain("タイトルまたはslugで検索");
    expect(html).toContain("保存して公開");
    expect(html).toContain("学習シリーズ");
  });

  it("marks an article already owned by another series as unavailable", () => {
    const html = renderToStaticMarkup(createElement(CmsSeriesManager, props));

    expect(html).toContain("「学習シリーズ」に所属");
    expect(html).toMatch(/<button disabled="" type="button">追加<\/button>/);
  });
});
