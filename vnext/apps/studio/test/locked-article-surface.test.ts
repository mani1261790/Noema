import { describe, expect, it } from "vitest";
import { resolveLockedArticleSurface } from "../src/locked-article-surface";

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
});
