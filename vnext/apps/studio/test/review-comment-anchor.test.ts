import { describe, expect, it } from "vitest";
import {
  createReviewCommentAnchor,
  createReviewCommentAnchorFromRenderedSelection,
  getRenderedReviewCommentQuote,
  locateReviewCommentAnchor
} from "../src/review-comment-anchor";

describe("review comment anchors", () => {
  it("captures an exact Markdown selection with surrounding context", () => {
    const markdown = "## 導入\n\nこの説明を具体的にします。\n\n## 次へ";
    const startOffset = markdown.indexOf("この説明");
    const anchor = createReviewCommentAnchor(markdown, startOffset, startOffset + "この説明".length);
    expect(anchor).toMatchObject({ quote: "この説明", startOffset });
    expect(anchor && locateReviewCommentAnchor(markdown, anchor)).toEqual({
      endOffset: startOffset + "この説明".length,
      exact: true,
      startOffset
    });
  });

  it("relocates a quote after text was inserted before it", () => {
    const original = "## 導入\n\n対象の文章です。\n\n## 次へ";
    const startOffset = original.indexOf("対象の文章");
    const anchor = createReviewCommentAnchor(original, startOffset, startOffset + "対象の文章".length);
    const edited = "前置きを追加します。\n\n" + original;
    expect(anchor && locateReviewCommentAnchor(edited, anchor)).toEqual({
      endOffset: edited.indexOf("対象の文章") + "対象の文章".length,
      exact: false,
      startOffset: edited.indexOf("対象の文章")
    });
  });

  it("selects the duplicate quote whose surrounding context matches", () => {
    const original = "## 前半\n\n前半で対象の文章です。\n\n## 後半\n\n後半で対象の文章です。";
    const startOffset = original.lastIndexOf("対象の文章");
    const anchor = createReviewCommentAnchor(original, startOffset, startOffset + "対象の文章".length);
    const edited = "追記します。\n\n" + original;
    expect(anchor && locateReviewCommentAnchor(edited, anchor)).toMatchObject({
      exact: false,
      startOffset: edited.lastIndexOf("対象の文章")
    });
  });

  it("reports a removed quote as unavailable", () => {
    const anchor = createReviewCommentAnchor("修正前の文章", 0, "修正前".length);
    expect(anchor && locateReviewCommentAnchor("修正後の文章", anchor)).toBeNull();
  });

  it("maps a rendered article selection back to its Markdown source", () => {
    const markdown = "## 導入\n\nレンダリングされた本文から指摘します。\n\n## 次へ";
    const anchor = createReviewCommentAnchorFromRenderedSelection(
      markdown,
      "本文から指摘",
      "レンダリングされた",
      "します。"
    );
    expect(anchor).toMatchObject({
      quote: "本文から指摘",
      startOffset: markdown.indexOf("本文から指摘")
    });
  });

  it("uses rendered context to distinguish repeated selections", () => {
    const markdown = "前半で対象を説明します。\n\n後半で対象を詳しく説明します。";
    const anchor = createReviewCommentAnchorFromRenderedSelection(
      markdown,
      "対象",
      "後半で",
      "を詳しく説明します。"
    );
    expect(anchor?.startOffset).toBe(markdown.lastIndexOf("対象"));
  });

  it("maps rendered whitespace to Markdown line breaks", () => {
    const markdown = "改行を含む\n文章を選びます。";
    const anchor = createReviewCommentAnchorFromRenderedSelection(
      markdown,
      "改行を含む 文章"
    );
    expect(anchor?.quote).toBe("改行を含む\n文章");
  });

  it("maps a rendered selection across inline Markdown formatting", () => {
    const markdown = "これは**重要な説明**です。";
    const anchor = createReviewCommentAnchorFromRenderedSelection(
      markdown,
      "これは重要な説明です"
    );
    expect(anchor?.quote).toBe("これは**重要な説明**です");
    expect(anchor && getRenderedReviewCommentQuote(anchor.quote)).toBe("これは重要な説明です");
  });
});
