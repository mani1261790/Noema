import { describe, expect, it } from "vitest";
import {
  extractArticleHeadingSlugs,
  validateArticleMarkdown,
} from "./article-markdown";

const validate = (source: string) =>
  validateArticleMarkdown(source, { minimumCharacters: 0 });
const errorCodes = (source: string) =>
  validate(source)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);

describe("validateArticleMarkdown", () => {
  it("accepts ordinary Markdown with a continuous heading hierarchy", () => {
    const source = [
      "## はじめに",
      "",
      "本文です。<https://example.com> と <editor@example.com> を参照します。",
      "",
      "### 詳細",
      "",
      "#### 補足",
      "",
      "## まとめ",
      "",
      "![処理の流れ](/images/flow.png)",
    ].join("\n");

    expect(errorCodes(source)).toEqual([]);
  });

  it.each([
    ["block script", "## 見出し\n\n<script>alert(1)</script>"],
    ["inline element", "## 見出し\n\n本文 <span>値</span>"],
    ["event handler", "## 見出し\n\n<img src=x onerror=alert(1)>"],
    ["comment", "## 見出し\n\n<!-- editorial note -->"],
  ])("rejects raw HTML: %s", (_name, source) => {
    expect(errorCodes(source)).toContain("raw-html");
  });

  it("does not inspect HTML and Markdown examples inside code", () => {
    const source = [
      "## コード例",
      "",
      "`<script>alert(1)</script>`",
      "",
      "~~~html",
      "<script>alert(1)</script>",
      "# H1",
      "![](missing.png)",
      "[missing](#not-found)",
      "~~~",
    ].join("\n");

    expect(errorCodes(source)).toEqual([]);
  });

  it("reports body H1, a non-H2 first heading, and skipped levels", () => {
    const source = [
      "# 本文H1",
      "",
      "### 最初からH3",
      "",
      "##### H5へ飛ぶ",
    ].join("\n");

    expect(errorCodes(source)).toEqual(
      expect.arrayContaining(["h1-heading", "heading-start", "heading-order"]),
    );
  });

  it("rejects images without meaningful alternative text", () => {
    expect(errorCodes("## 見出し\n\n![](image.png)")).toContain("image-alt");
    expect(
      errorCodes('## 見出し\n\n![   ](image.png "画像タイトル")'),
    ).toContain("image-alt");
    expect(
      errorCodes("## 見出し\n\n![処理の *流れ*](image.png)"),
    ).not.toContain("image-alt");
  });

  it("matches local fragments against Astro-compatible heading slugs", () => {
    const source = [
      "## Hello *world* & more",
      "",
      "## Copyright (c) 2026",
      "",
      "## A ![B](x.png) C",
      "",
      "## Foo -- bar",
      "",
      "## foo---bar",
      "",
      "## 重複",
      "",
      "## 重複",
      "",
      "[最初](#hello-world--more)",
      "[2件目](#重複-1)",
    ].join("\n");

    expect(extractArticleHeadingSlugs(source)).toEqual([
      "hello-world--more",
      "copyright-c-2026",
      "a--c",
      "foo----bar",
      "foo---bar",
      "重複",
      "重複-1",
    ]);
    expect(errorCodes(source)).toEqual([]);
    expect(errorCodes("## 見出し A\n\n[移動](#missing)")).toContain(
      "missing-fragment",
    );
    expect(
      errorCodes("## 見出し A\n\n[移動](#%E8%A6%8B%E5%87%BA%E3%81%97-a)"),
    ).toEqual([]);
  });

  it("validates internal article paths and known targets", () => {
    const targetHeadings = new Map([["existing", new Set(["section"])]]);
    const valid = "## 見出し\n\n[記事](/articles/existing#section)";
    const missing = "## 見出し\n\n[記事](/articles/missing)";
    const missingSection =
      "## 見出し\n\n[記事](https://noema-learn.uk/articles/existing#missing)";

    expect(
      validateArticleMarkdown(valid, {
        articleSlugs: ["existing"],
        articleHeadingSlugs: targetHeadings,
        minimumCharacters: 0,
      }).filter((issue) => issue.severity === "error"),
    ).toEqual([]);
    expect(
      validateArticleMarkdown(missing, {
        articleSlugs: ["existing"],
        minimumCharacters: 0,
      }).map((issue) => issue.code),
    ).toContain("missing-article");
    expect(
      validateArticleMarkdown(missingSection, {
        articleSlugs: ["existing"],
        articleHeadingSlugs: targetHeadings,
        minimumCharacters: 0,
      }).map((issue) => issue.code),
    ).toContain("missing-article-fragment");
    expect(errorCodes("## 見出し\n\n[相対リンク](../existing.md)")).toContain(
      "relative-link",
    );
    expect(
      errorCodes("## 見出し\n\n[相対リンク](articles/existing)"),
    ).toContain("relative-link");
    expect(
      errorCodes("## 見出し\n\n[query](/articles/existing?preview=1)"),
    ).toContain("invalid-article-link");
  });

  it.each([
    ["direct", "[危険](javascript:alert(1))", "unsafe-link"],
    ["encoded", "[危険](java&#x73;cript:alert(1))", "unsafe-link"],
    ["mixed case", "[危険](JaVaScRiPt:alert(1))", "unsafe-link"],
    ["autolink", "<javascript:alert(1)>", "unsafe-link"],
    ["data link", "[危険](data:text/html;base64,PHNjcmlwdD4=)", "unsafe-link"],
    ["data image", "![説明](data:image/svg+xml,<svg></svg>)", "unsafe-image"],
    ["empty link", "[空のリンク]()", "unsafe-link"],
    ["empty image", "![説明]()", "unsafe-image"],
  ])("rejects an unsafe Markdown destination: %s", (_name, markdown, code) => {
    expect(errorCodes(`## 見出し\n\n${markdown}`)).toContain(code);
  });

  it("reports the actual body line for inline issues", () => {
    const issues = validate(
      [
        "## 見出し",
        "",
        "段落の開始",
        "本文の続き",
        "<span>HTML</span>",
        "![](/images/example.png)",
        "[相対](relative-page)",
      ].join("\n"),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "raw-html", line: 5 }),
        expect.objectContaining({ code: "image-alt", line: 6 }),
        expect.objectContaining({ code: "relative-link", line: 7 }),
      ]),
    );
  });

  it.each([
    ["multiline code", "start `code\ncontinues` [相対](relative-page)"],
    [
      "multiline inline HTML",
      "start <span\ntitle=x>HTML</span> [相対](relative-page)",
    ],
  ])("keeps line locations after %s", (_name, paragraph) => {
    const issues = validate(`## 見出し\n\n${paragraph}`);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "relative-link", line: 4 }),
      ]),
    );
  });

  it("warns when Studio cannot verify an article target against a corpus", () => {
    expect(validate("## 見出し\n\n[記事](/articles/existing)")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unchecked-article-link",
          severity: "warning",
        }),
      ]),
    );
  });

  it("keeps distinct missing article errors on the same line", () => {
    const issues = validateArticleMarkdown(
      "## 見出し\n\n[A](/articles/missing-a) [B](/articles/missing-b)",
      { articleSlugs: [], minimumCharacters: 0 },
    ).filter((issue) => issue.code === "missing-article");

    expect(issues).toHaveLength(2);
  });

  it("returns a blocking error for an empty body and a warning for a short body", () => {
    expect(validateArticleMarkdown("  ")).toEqual([
      expect.objectContaining({ code: "empty-body", severity: "error" }),
    ]);
    expect(validateArticleMarkdown("## 短い本文")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "short-body", severity: "warning" }),
      ]),
    );
  });
});
