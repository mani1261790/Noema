import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsAcquisition } from "../src/CmsAnalyticsDashboard";

describe("AnalyticsAcquisition", () => {
  it("shows channel and organic article outcomes without claiming user-level conversion", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsAcquisition, {
      channels: [{
        article50: 4,
        article50Rate: 0.8,
        articleEnd: 3,
        channel: "organic_search",
        landing: 5,
        navigationClick: 2,
        onwardRate: 2 / 3,
        qualifiedReadRate: 0.6
      }, {
        article50: 1,
        article50Rate: 0.5,
        articleEnd: 1,
        channel: "campaign",
        landing: 2,
        navigationClick: 0,
        onwardRate: 0,
        qualifiedReadRate: 0.5
      }],
      organicArticles: [{
        article50: 4,
        article50Rate: 0.8,
        articleEnd: 3,
        articleId: "11111111-1111-4111-8111-111111111111",
        landing: 5,
        navigationClick: 2,
        onwardRate: 2 / 3,
        qualifiedReadRate: 0.6,
        revisionNumber: 4,
        slug: "organic-search-article",
        title: "検索から読まれた記事"
      }]
    }));

    expect(html).toContain("検索流入が読了につながったか");
    expect(html).toContain("自然検索");
    expect(html).toContain("UTM付き施策");
    expect(html).toContain("検索語や読者IDは保存せず");
    expect(html).toContain("読者単位の転換率ではありません");
    expect(html).toContain("検索から読まれた記事");
    expect(html).toContain("organic-search-article・rev.4");
    expect(html).toContain("80%");
    expect(html).toContain("60%");
  });
});
