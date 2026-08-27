import { describe, expect, it } from "vitest";
import { classifyArticleEntry } from "./analytics-entry";

describe("article analytics entry classification", () => {
  const origin = "https://noema-learn.uk";

  it.each([
    ["", "direct"],
    ["not a URL", "direct"],
    ["https://example.com/articles/intro", "external"],
    ["https://noema-learn.uk/", "home"],
    ["https://noema-learn.uk/?from=header", "home"],
    ["https://noema-learn.uk/articles", "article_index"],
    ["https://noema-learn.uk/articles/", "article_index"],
    ["https://noema-learn.uk/series/start-ai-development", "series"],
    ["https://noema-learn.uk/topics/development-environment", "topic"],
    ["https://noema-learn.uk/articles/what-is-git-and-github", "article"],
    ["https://noema-learn.uk/about", "other_internal"]
  ] as const)("classifies %s as %s", (referrer, expected) => {
    expect(classifyArticleEntry(referrer, origin)).toBe(expected);
  });

  it("does not treat a lookalike hostname as an internal entry", () => {
    expect(classifyArticleEntry("https://noema-learn.uk.example.com/", origin)).toBe("external");
  });
});
