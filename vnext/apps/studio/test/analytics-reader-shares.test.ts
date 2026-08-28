import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CmsAnalyticsArticleMetric,
  CmsAnalyticsReaderShareArticleMetric
} from "@noema/cms";
import { AnalyticsReaderShares } from "../src/CmsAnalyticsDashboard";

function article(overrides: Partial<CmsAnalyticsArticleMetric> = {}): CmsAnalyticsArticleMetric {
  return {
    article50: 6,
    article50Rate: 0.75,
    articleEnd: 4,
    articleId: "11111111-1111-4111-8111-111111111111",
    assistantError: 0,
    assistantOpen: 0,
    assistantSuccess: 0,
    assistantSuccessRate: null,
    assistantUseRate: 0,
    landing: 8,
    navigationClick: 2,
    onwardRate: 0.5,
    qualifiedReadRate: 0.5,
    relatedClick: 2,
    revisionNumber: 3,
    seriesNext: 0,
    share: 4,
    slug: "what-is-coding-agent",
    title: "コーディングエージェントとは何か",
    updatesAction: 0,
    updatesActionRate: null,
    updatesClick: 1,
    updatesGuideRate: 0.25,
    ...overrides
  };
}

function inbound(
  overrides: Partial<CmsAnalyticsReaderShareArticleMetric> = {}
): CmsAnalyticsReaderShareArticleMetric {
  return {
    article50: 2,
    article50Rate: 2 / 3,
    articleEnd: 1,
    articleId: "11111111-1111-4111-8111-111111111111",
    landing: 3,
    method: "native",
    navigationClick: 1,
    onwardRate: 1,
    qualifiedReadRate: 1 / 3,
    revisionNumber: 3,
    slug: "what-is-coding-agent",
    title: "コーディングエージェントとは何か",
    ...overrides
  };
}

describe("AnalyticsReaderShares", () => {
  it("puts share actions and anonymous inbound outcomes in one article-level view", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsReaderShares, {
      articles: [article()],
      inbound: [
        inbound(),
        inbound({
          article50: 1,
          article50Rate: 0.5,
          articleEnd: 1,
          landing: 2,
          method: "copy",
          navigationClick: 0,
          onwardRate: 0,
          qualifiedReadRate: 0.5
        })
      ]
    }));

    expect(html).toContain("共有が、新しい記事到達につながったか");
    expect(html).toContain("コーディングエージェントとは何か");
    expect(html).toContain("共有シート 3 / URLコピー 2");
    expect(html).toContain("60%");
    expect(html).toContain("40%");
    expect(html).toContain("50%");
    expect(html).toContain("共有操作から到達への転換率は計算しません");
  });

  it("keeps future share methods visible and explains the empty state", () => {
    const unknownHtml = renderToStaticMarkup(createElement(AnalyticsReaderShares, {
      articles: [],
      inbound: [inbound({ landing: 1, method: "messenger" })]
    }));
    const emptyHtml = renderToStaticMarkup(createElement(AnalyticsReaderShares, {
      articles: [],
      inbound: []
    }));

    expect(unknownHtml).toContain("messenger 1");
    expect(emptyHtml).toContain("共有操作と、共有リンクからの記事到達はまだありません");
  });
});
