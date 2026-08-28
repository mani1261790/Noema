import { getRssString } from "@astrojs/rss";
import type { ArticleSummary } from "@noema/content";
import { describe, expect, it } from "vitest";

import { createNoemaRssItems } from "./rss";

function article(
  slug: string,
  publishedAt: string,
  overrides: Partial<ArticleSummary> = {},
): ArticleSummary {
  return {
    approach: "experience",
    authors: ["Noema編集部"],
    description: `${slug}の説明`,
    excerpt: `${slug}の概要`,
    heroImage: null,
    href: `/articles/${slug}`,
    publishedAt,
    slug,
    tags: ["AI"],
    title: `${slug}の記事`,
    topics: ["conversational-ai"],
    updatedAt: publishedAt,
    ...overrides,
  };
}

describe("Noema RSS items", () => {
  it("uses the canonical no-trailing-slash article URL for links and GUIDs", async () => {
    const items = createNoemaRssItems(
      [article("first-article", "2026-08-28")],
      new URL("https://noema-learn.uk"),
    );
    const xml = await getRssString({
      title: "Noema",
      description: "Noema feed",
      site: new URL("https://noema-learn.uk"),
      items,
    });

    expect(items[0]?.link).toBe("https://noema-learn.uk/articles/first-article");
    expect(xml).toContain("<link>https://noema-learn.uk/articles/first-article</link>");
    expect(xml).toContain('<guid isPermaLink="true">https://noema-learn.uk/articles/first-article</guid>');
    expect(xml).not.toContain("https://noema-learn.uk/articles/first-article/");
  });

  it("orders new articles first without mutating the source list", () => {
    const older = article("older", "2026-08-27");
    const newer = article("newer", "2026-08-28");
    const source = [older, newer];

    expect(createNoemaRssItems(source).map((item) => item.link)).toEqual([
      "https://noema-learn.uk/articles/newer",
      "https://noema-learn.uk/articles/older",
    ]);
    expect(source).toEqual([older, newer]);
  });
});
