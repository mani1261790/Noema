import { describe, expect, it } from "vitest";

import {
  findNarrowingTopicForArticle,
  listActiveTopics,
  listNarrowingTopics,
  topicListingResponse
} from "./topics";

describe("listActiveTopics", () => {
  it("lists only topics represented by public articles in schema order", () => {
    const topics = listActiveTopics([
      { topics: ["data-models", "development-environment"] },
      { topics: ["conversational-ai", "data-models"] }
    ]);

    expect(topics.map(({ slug, articleCount }) => ({ slug, articleCount }))).toEqual([
      { slug: "conversational-ai", articleCount: 1 },
      { slug: "development-environment", articleCount: 1 },
      { slug: "data-models", articleCount: 2 }
    ]);
    expect(topics[0]).toMatchObject({
      label: "対話AI",
      description: expect.stringContaining("AIとの対話")
    });
  });

  it("counts a topic once per article", () => {
    expect(listActiveTopics([{ topics: ["data-models", "data-models"] }])).toMatchObject([
      { slug: "data-models", articleCount: 1 }
    ]);
  });

  it("returns no navigation targets when there are no public articles", () => {
    expect(listActiveTopics([])).toEqual([]);
  });
});

describe("topicListingResponse", () => {
  it("keeps populated topic pages indexable", () => {
    expect(topicListingResponse(1)).toEqual({ noindex: false, status: 200 });
  });

  it("reports empty topic pages as noindex 404s instead of thin indexable pages", () => {
    expect(topicListingResponse(0)).toEqual({ noindex: true, status: 404 });
  });
});

describe("listNarrowingTopics", () => {
  it("keeps only topic choices that narrow the public article set", () => {
    const articles: Parameters<typeof listActiveTopics>[0] = [
      { topics: ["development-environment", "conversational-ai"] },
      { topics: ["development-environment", "data-models"] }
    ];

    expect(listNarrowingTopics(articles).map(({ slug, articleCount }) => ({
      slug,
      articleCount
    }))).toEqual([
      { slug: "conversational-ai", articleCount: 1 },
      { slug: "data-models", articleCount: 1 }
    ]);
    expect(listActiveTopics(articles)).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "development-environment", articleCount: 2 })
    ]));
  });

  it("returns no discovery choices when every represented topic is universal", () => {
    expect(listNarrowingTopics([{ topics: ["development-environment"] }])).toEqual([]);
    expect(listNarrowingTopics([])).toEqual([]);
  });
});

describe("findNarrowingTopicForArticle", () => {
  const articles: Parameters<typeof listActiveTopics>[0] = [
    { topics: ["development-environment"] },
    { topics: ["development-environment", "data-models"] },
    { topics: ["development-environment", "data-models"] },
    { topics: ["development-environment", "conversational-ai"] }
  ];

  it("selects the most specific public topic assigned to the article", () => {
    expect(findNarrowingTopicForArticle(articles[1], articles)).toMatchObject({
      slug: "data-models",
      articleCount: 2
    });
    expect(findNarrowingTopicForArticle(articles[3], articles)).toMatchObject({
      slug: "conversational-ai",
      articleCount: 1
    });
  });

  it("omits the topic route when every assigned topic covers the full catalog", () => {
    expect(findNarrowingTopicForArticle(articles[0], articles)).toBeNull();
  });

  it("preserves article topic order when equally specific topics are available", () => {
    const equalTopics: Parameters<typeof listActiveTopics>[0] = [
      { topics: ["development-environment", "data-models", "conversational-ai"] },
      { topics: ["development-environment"] }
    ];

    expect(findNarrowingTopicForArticle(equalTopics[0], equalTopics)?.slug).toBe("data-models");
  });
});
