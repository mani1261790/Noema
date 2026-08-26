import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsReviewComments } from "../src/CmsReviewComments";

const baseProps = {
  activeAnchor: null,
  body: "",
  busy: false,
  canComment: true,
  canReopen: false,
  canResolve: false,
  comments: [],
  inputRef: { current: null },
  loading: false,
  mode: "review" as const,
  onActiveAnchorClear: () => undefined,
  onBodyChange: () => undefined,
  onCommentFocus: () => undefined,
  onStatusChange: () => undefined,
  onSubmit: () => undefined
};

describe("CmsReviewComments", () => {
  it("asks reviewers to select from the rendered article without a target selector", () => {
    const html = renderToStaticMarkup(createElement(CmsReviewComments, baseProps));

    expect(html).toContain("レンダリングされた記事本文で指摘したい箇所を選択");
    expect(html).toContain("記事本文で、指摘したい箇所を選択してください。");
    expect(html).not.toContain("コメント対象");
    expect(html).not.toContain("Markdown本文から");
    expect(html).not.toContain("<select");
  });

  it("turns existing comments into an editing checklist in response mode", () => {
    const html = renderToStaticMarkup(createElement(CmsReviewComments, {
      ...baseProps,
      canComment: false,
      canResolve: true,
      comments: [{
        anchor: {
          endOffset: 6,
          prefix: "",
          quote: "説明する箇所",
          startOffset: 0,
          suffix: ""
        },
        articleId: "article-1",
        authorEmail: "reviewer@example.com",
        body: "具体例を追加してください。",
        createdAt: "2026-08-26T00:00:00.000Z",
        id: "comment-1",
        resolvedAt: null,
        resolvedByEmail: null,
        resolvedRevisionId: null,
        resolvedRevisionNumber: null,
        revisionId: "revision-1",
        revisionNumber: 1,
        status: "open" as const,
        target: "body" as const
      }],
      mode: "response"
    }));

    expect(html).toContain("未対応の指摘を開き、Markdownを修正してから対応済みにします。");
    expect(html).toContain("Markdownの該当箇所を開く");
    expect(html).toContain("修正を保存して対応済みにする");
    expect(html).not.toContain("指摘を追加");
  });

  it("enables submission only after a rendered article selection is captured", () => {
    const html = renderToStaticMarkup(createElement(CmsReviewComments, {
      ...baseProps,
      activeAnchor: {
        endOffset: 8,
        prefix: "",
        quote: "選択した箇所",
        startOffset: 2,
        suffix: ""
      },
      body: "ここを修正してください。"
    }));

    expect(html).toContain("選択した箇所");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>指摘を追加<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*type="submit"/);
  });
});
