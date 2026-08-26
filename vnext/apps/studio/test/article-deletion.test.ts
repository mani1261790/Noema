import { describe, expect, it } from "vitest";
import { canDeleteCmsDraftArticle } from "../src/article-deletion";

const draft = {
  publicationStatus: "unpublished" as const,
  publishedRevisionNumber: null,
  reviewStatus: "draft" as const
};

describe("draft article deletion", () => {
  it("is available only to editors for a never-published draft", () => {
    expect(canDeleteCmsDraftArticle(draft, true)).toBe(true);
    expect(canDeleteCmsDraftArticle(draft, false)).toBe(false);
    expect(canDeleteCmsDraftArticle(null, true)).toBe(false);
  });

  it("stays unavailable during review and after any publication", () => {
    expect(canDeleteCmsDraftArticle({ ...draft, reviewStatus: "in_review" }, true)).toBe(false);
    expect(canDeleteCmsDraftArticle({ ...draft, publicationStatus: "published" }, true)).toBe(false);
    expect(canDeleteCmsDraftArticle({ ...draft, publishedRevisionNumber: 1 }, true)).toBe(false);
  });
});
