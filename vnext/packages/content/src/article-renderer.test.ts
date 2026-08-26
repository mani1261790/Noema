import { describe, expect, it } from "vitest";
import { extractArticleLinkReferences, validateArticleMarkdown } from "./article-markdown";
import { renderArticlePresentation } from "./article-presentation";
import {
  createArticleMarkdownRenderer,
  renderArticleMarkdown,
  renderArticleMarkdownWith,
} from "./article-renderer";
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
  it("renders parenthesized strong text before a Japanese suffix", () => {
    const html = renderArticleMarkdown([
      "**ブランチ（branch）**の役割を説明します。",
      "",
      "**エディター（editor）**を使います。",
      "",
      "**通常の太字**も表示します。",
    ].join("\n"));

    expect(html).toContain("<strong>ブランチ（branch）</strong>の役割");
    expect(html).toContain("<strong>エディター（editor）</strong>を使います");
    expect(html).toContain("<strong>通常の太字</strong>も表示します");
    expect(renderArticleMarkdown("**branch）**suffix")).toContain("**branch）**suffix");
  });

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

  it("extracts canonical internal article links with fragments and source lines", () => {
    expect(extractArticleLinkReferences([
      "## 本文",
      "",
      "[公開予定](/articles/future#概要)",
      "[外部](https://example.com/articles/other)",
    ].join("\n"))).toEqual([
      { fragment: "概要", href: "/articles/future#%E6%A6%82%E8%A6%81", line: 3, slug: "future" },
    ]);
  });

  it("renders an unavailable article reference as explanatory text instead of a link", () => {
    const renderer = createArticleMarkdownRenderer({
      resolveLinkAvailability: (href) => href === "/articles/future" ? "unavailable" : "available",
    });
    const html = renderArticleMarkdownWith(
      renderer,
      "[公開中](/articles/current)と[次の記事](/articles/future)を参照します。",
    );

    expect(html).toContain('<a href="/articles/current">公開中</a>');
    expect(html).toContain('<span class="article-link-unavailable">次の記事</span><span class="article-link-unavailable__status">（現在は公開されていません）</span>');
    expect(html).not.toContain('href="/articles/future"');
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

  it("renders the connected editor as a safe profile link", () => {
    const html = renderArticlePresentation(frontmatter, "## 本文\n\n説明です。", {
      editor: { href: "/editors/0123?x=\"", name: "山田 <編集>" }
    });

    expect(html).toContain("<dt>編集者</dt>");
    expect(html).toContain('href="/editors/0123?x=&quot;"');
    expect(html).toContain("山田 &lt;編集&gt;");
    expect(html.match(/山田 &lt;編集&gt;/g)).toHaveLength(1);
    expect(html).not.toContain("<dt>執筆</dt>");
    expect(html).not.toContain("Noema編集部");
  });

  it("uses the editorial authors as the single editor fallback", () => {
    const html = renderArticlePresentation(frontmatter, "## 本文\n\n説明です。");

    expect(html).toContain("<dt>編集者</dt><dd>Noema編集部</dd>");
    expect(html).not.toContain("<dt>執筆</dt>");
  });
});
