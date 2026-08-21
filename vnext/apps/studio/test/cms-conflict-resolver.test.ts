import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsArticleDetail } from "@noema/cms";
import { CmsConflictResolver } from "../src/CmsConflictResolver";
import { createBlankArticle } from "../src/draft-storage";

const latestFrontmatter = {
  ...createBlankArticle("2026-08-20"),
  title: "CMSのタイトル",
  slug: "conflict-example"
};

const article: CmsArticleDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  lockVersion: 12,
  publicationStatus: "unpublished",
  revisionNumber: 12,
  reviewStatus: "draft",
  slug: latestFrontmatter.slug,
  title: latestFrontmatter.title,
  updatedAt: "2026-08-20T01:00:00.000Z",
  updatedByEmail: "editor@example.com",
  visibility: "public",
  currentRevision: {
    createdAt: "2026-08-20T01:00:00.000Z",
    createdByEmail: "editor@example.com",
    frontmatter: latestFrontmatter,
    id: "22222222-2222-4222-8222-222222222222",
    markdown: "## 共通\n\nCMSの本文\n",
    number: 12
  },
  publishedRevisionNumber: null,
  publishedSlug: null,
  publishedVisibility: null,
  reviewNote: null
};

const baseProps: ComponentProps<typeof CmsConflictResolver> = {
  busy: false,
  latestState: { article, kind: "ready" },
  localBody: "## 共通\n\nブラウザの本文\n",
  localFrontmatter: { ...latestFrontmatter, title: "ブラウザのタイトル" },
  localVisibility: "public",
  onBack: () => undefined,
  onDownload: () => undefined,
  onResolve: () => undefined,
  onRetry: () => undefined,
  onUseLatest: () => undefined
};

function renderResolver(overrides: Partial<ComponentProps<typeof CmsConflictResolver>> = {}): string {
  return renderToStaticMarkup(createElement(CmsConflictResolver, { ...baseProps, ...overrides }));
}

describe("CmsConflictResolver", () => {
  it("puts the three resolution paths next to the conflict explanation", () => {
    const html = renderResolver();

    expect(html).toContain("重なった変更を確認してください");
    expect(html).toContain("重ならない変更はすでに取り込んでいます");
    expect(html).toContain("新しいrevisionとしてCMSへ保存します");
    expect(html).toContain("ブラウザの原稿を採用");
    expect(html).toContain("CMS最新版を採用");
    expect(html).toContain("ブラウザの原稿を書き出す");
    expect(html).toContain("編集画面に戻る");
    expect(html).toContain("revision 12");
    expect(html).toContain("editor@example.com");
  });

  it("offers field-level and line-block choices without using color alone", () => {
    const html = renderResolver();

    expect(html).toContain("タイトル");
    expect(html).toContain("本文の変更 1");
    expect(html).toContain("ブラウザのタイトル");
    expect(html).toContain("CMSのタイトル");
    expect(html).toContain("ブラウザの本文");
    expect(html).toContain("CMSの本文");
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html.match(/tabindex="0"/g)).toHaveLength(4);
    expect(html).toContain("aria-label=\"タイトル ブラウザ側の内容\"");
    expect(html).toContain("ブラウザ側を使う");
    expect(html).toContain("CMS側を使う");
    expect(html).toContain("選んだ内容で解消して保存");
  });

  it("keeps recovery actions available when the latest revision cannot load", () => {
    const html = renderResolver({
      latestState: { kind: "error", message: "通信に失敗しました。" }
    });

    expect(html).toContain("CMSの最新版を読み込めませんでした");
    expect(html).toContain("もう一度読み込む");
    expect(html).toContain("ブラウザの原稿を書き出す");
  });
});
