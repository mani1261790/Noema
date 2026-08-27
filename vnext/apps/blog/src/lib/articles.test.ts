import type { ArticleSummary } from "@noema/content";
import { describe, expect, it } from "vitest";

import { selectStandaloneArticles } from "./articles";

function article(slug: string, publishedAt: string): ArticleSummary {
  return {
    approach: "development",
    authors: ["Noema編集部"],
    description: `${slug}の説明`,
    excerpt: `${slug}の概要`,
    heroImage: null,
    href: `/articles/${slug}`,
    publishedAt,
    slug,
    tags: [],
    title: slug,
    topics: ["development-environment"],
    updatedAt: publishedAt,
  };
}

describe("selectStandaloneArticles", () => {
  it("excludes articles included in any published series", () => {
    const standalone = article("standalone", "2026-08-20");
    const firstSeriesArticle = article("series-one", "2026-08-22");
    const secondSeriesArticle = article("series-two", "2026-08-21");

    expect(
      selectStandaloneArticles(
        [standalone, firstSeriesArticle, secondSeriesArticle],
        [
          { items: [firstSeriesArticle] },
          { items: [secondSeriesArticle] },
        ],
      ),
    ).toEqual([standalone]);
  });

  it("returns the newest standalone articles up to the requested limit", () => {
    const oldest = article("oldest", "2026-08-18");
    const newest = article("newest", "2026-08-20");
    const middle = article("middle", "2026-08-19");

    expect(
      selectStandaloneArticles([oldest, newest, middle], [], 2).map(({ slug }) => slug),
    ).toEqual(["newest", "middle"]);
  });

  it("returns no articles for a zero or negative limit", () => {
    const standalone = article("standalone", "2026-08-20");

    expect(selectStandaloneArticles([standalone], [], 0)).toEqual([]);
    expect(selectStandaloneArticles([standalone], [], -1)).toEqual([]);
  });

  it("does not mutate the source order", () => {
    const oldest = article("oldest", "2026-08-18");
    const newest = article("newest", "2026-08-20");
    const articles = [oldest, newest];

    selectStandaloneArticles(articles, []);

    expect(articles.map(({ slug }) => slug)).toEqual(["oldest", "newest"]);
  });
});
