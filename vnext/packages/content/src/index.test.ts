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

it("round-trips optional reference comments through article Markdown", async () => {
  const { serializeArticle, parseArticle } = await import('./index');
  const source = {title:'公式資料',url:'https://example.com',checkedAt:'2026-10-24',comment:'式の説明を参照。\n「引用」や <tag> も本文として扱う。'};
  const article = articleFrontmatterSchema.parse({...previewArticles[0],sources:[source]});
  expect((await parseArticle(serializeArticle(article,'## 本文\n\n説明'))).frontmatter.sources).toEqual([source]);
  expect(articleFrontmatterSchema.safeParse({...article,sources:[{...source,comment:'a'.repeat(1001)}]}).success).toBe(false);
});
