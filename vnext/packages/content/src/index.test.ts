import { describe, expect, it } from "vitest";
import { articleFrontmatterSchema, previewArticles } from "./index";

describe("articleFrontmatterSchema URL policy", () => {
  const article = previewArticles[0];

  it.each(["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4="])(
    "rejects an unsafe source URL: %s",
    (url) => {
      expect(
        articleFrontmatterSchema.safeParse({
          ...article,
          sources: [{ title: "危険な資料", url, checkedAt: "2026-07-17" }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects an unsafe hero image destination", () => {
    expect(
      articleFrontmatterSchema.safeParse({
        ...article,
        heroImage: { src: "data:image/svg+xml,<svg></svg>", alt: "図" },
      }).success,
    ).toBe(false);
  });

  it("accepts https sources and root-relative images", () => {
    expect(articleFrontmatterSchema.safeParse(article).success).toBe(true);
  });
});
