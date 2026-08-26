import { describe, expect, it } from "vitest";
import {
  resolveArticleOpeningSurface,
  resolveLockedArticleSurface,
  resolveReviewCommentFocusSurface
} from "../src/locked-article-surface";

describe("locked article surface", () => {
  it("opens an article preview beside the review controls", () => {
    expect(resolveLockedArticleSurface(false, "in_review")).toEqual({
      mode: "review",
      previewOnly: true
    });
  });

  it("keeps an approved article visible beside the publishing controls", () => {
    expect(resolveLockedArticleSurface(true, "approved")).toEqual({
      mode: "publish",
      previewOnly: true
    });
  });

  it("opens requested changes as an editable review-response surface", () => {
    expect(resolveArticleOpeningSurface(true, false, "changes_requested")).toEqual({
      mode: "review",
      previewOnly: false
    });
  });

  it("opens review comments in Markdown only while an editor can respond", () => {
    expect(resolveReviewCommentFocusSurface(true, "changes_requested")).toBe("markdown");
    expect(resolveReviewCommentFocusSurface(true, "draft")).toBe("markdown");
    expect(resolveReviewCommentFocusSurface(false, "changes_requested")).toBe("preview");
    expect(resolveReviewCommentFocusSurface(true, "in_review")).toBe("preview");
  });
});
