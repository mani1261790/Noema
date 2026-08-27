import type { ArticleSummary } from "@noema/content";
import { describe, expect, it } from "vitest";

import { findRelatedArticles, selectStandaloneArticles } from "./articles";

function article(
  slug: string,
  publishedAt: string,
  overrides: Partial<ArticleSummary> = {},
): ArticleSummary {
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
    ...overrides,
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

describe("findRelatedArticles", () => {
  it("does not recommend an article based only on one broad topic", () => {
    const current = article("current", "2026-08-20", {
      tags: ["監視"],
    });
    const broadTopicOnly = article("broad-topic-only", "2026-08-22", {
      tags: ["ローカルLLM"],
    });

    expect(findRelatedArticles(current, [broadTopicOnly])).toEqual([]);
  });

  it("recommends articles with a shared tag", () => {
    const current = article("current", "2026-08-20", {
      tags: ["Git", "初学者"],
    });
    const sharedTag = article("shared-tag", "2026-08-21", {
      tags: ["Git", "用語集"],
    });
    const broadTopicOnly = article("broad-topic-only", "2026-08-22", {
      tags: ["ローカルLLM"],
    });

    expect(findRelatedArticles(current, [broadTopicOnly, sharedTag])).toEqual([sharedTag]);
  });

  it("recommends articles that share multiple topics", () => {
    const current = article("current", "2026-08-20", {
      tags: [],
      topics: ["development-environment", "data-models"],
    });
    const sharedTopics = article("shared-topics", "2026-08-21", {
      tags: [],
      topics: ["development-environment", "data-models"],
    });
    const singleTopic = article("single-topic", "2026-08-22", {
      tags: [],
      topics: ["development-environment"],
    });

    expect(findRelatedArticles(current, [singleTopic, sharedTopics])).toEqual([sharedTopics]);
  });

  it("keeps stronger relationships ahead of newer weaker matches", () => {
    const current = article("current", "2026-08-20", {
      tags: ["Git", "GitHub"],
    });
    const newerSingleTag = article("newer-single-tag", "2026-08-22", {
      tags: ["Git"],
    });
    const olderTwoTags = article("older-two-tags", "2026-08-21", {
      tags: ["Git", "GitHub"],
    });

    expect(findRelatedArticles(current, [newerSingleTag, olderTwoTags])).toEqual([
      olderTwoTags,
      newerSingleTag,
    ]);
  });
});
