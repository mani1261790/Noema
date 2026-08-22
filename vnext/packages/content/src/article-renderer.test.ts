import { describe, expect, it } from "vitest";
import { validateArticleMarkdown } from "./article-markdown";
import { renderArticlePresentation } from "./article-presentation";
import { renderArticleMarkdown } from "./article-renderer";
import type { ArticleFrontmatter } from "./index";

const frontmatter: ArticleFrontmatter = {
  approach: "development",
  authors: ["Noema編集部"],
  description: "共有レンダラーのテスト記事です。",
  estimatedMinutes: 5,
  heroImage: null,
  outcome: "共有表示を確認できる",
  prerequisites: [],
  slug: "shared-renderer",
  sources: [],
  status: "draft",
  tags: ["Markdown"],
  title: "共有レンダラー",
  topics: ["development-environment"],
  updatedAt: "2026-08-22",
};

describe("article Markdown extensions", () => {
  it("renders accordion content with semantic details and summary elements", () => {
    const html = renderArticleMarkdown([
      "## 本文",
      "",
      ":::accordion 詳しい手順",
      "",
      "- 項目A",
      "- **項目B**",
      "",
      ":::",
    ].join("\n"));

    expect(html).toContain('<details class="article-accordion">');
    expect(html).toContain("<summary>詳しい手順</summary>");
    expect(html).toContain("<strong>項目B</strong>");
    expect(html).toContain("</div></details>");
  });

  it("validates accordion titles, closing markers, and nesting", () => {
    const codes = (source: string) => validateArticleMarkdown(source, { minimumCharacters: 0 })
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.code);

    expect(codes("## 本文\n\n:::accordion 補足\n\n本文\n\n:::")).toEqual([]);
    expect(codes("## 本文\n\n:::accordion\n\n本文\n\n:::")).toContain("accordion-title");
    expect(codes("## 本文\n\n:::accordion 補足\n\n本文")).toContain("accordion-unclosed");
    expect(codes("## 本文\n\n:::accordion 外側\n\n:::accordion 内側\n\n本文\n\n:::\n\n:::")).toContain("accordion-nested");
  });
});

describe("renderArticlePresentation", () => {
  it("renders authored content and series navigation as one shared presentation", () => {
    const html = renderArticlePresentation(frontmatter, "## 本文\n\n説明です。", {
      series: {
        currentIndex: 1,
        description: "共有シリーズ",
        items: [
          { href: "/articles/first/", title: "最初の記事" },
          { href: "/articles/shared-renderer/", title: "現在の記事" },
          { href: "/articles/next/", title: "次の記事" },
        ],
        title: "レンダラーテスト",
      },
    });

    expect(html).toContain('<div class="article-presentation">');
    expect(html).toContain("シリーズ全体を見る");
    expect(html).toContain("前の記事へ");
    expect(html).toContain("次の記事");
    expect(html).toContain('<article class="article-body"><h2 id="本文">本文</h2>');
  });
});
