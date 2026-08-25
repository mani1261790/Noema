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
