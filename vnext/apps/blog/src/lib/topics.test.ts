import { describe, expect, it } from "vitest";

import { listActiveTopics } from "./topics";

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
