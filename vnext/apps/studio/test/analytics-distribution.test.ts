import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsAnalyticsArticleMetric, CmsAnalyticsSourceMetric } from "@noema/cms";
import { AnalyticsDistribution } from "../src/CmsAnalyticsDashboard";

const article: CmsAnalyticsArticleMetric = {
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
  share: 0,
  slug: "what-is-coding-agent",
  title: "コーディングエージェントとは何か",
  updatesAction: 0,
  updatesActionRate: null,
  updatesClick: 1,
  updatesGuideRate: 0.25
};

function source(overrides: Partial<CmsAnalyticsSourceMetric> = {}): CmsAnalyticsSourceMetric {
  return {
    article50: 3,
    article50Rate: 0.75,
    articleEnd: 2,
    campaign: "article_distribution",
    content: "what-is-coding-agent",
    landing: 4,
    medium: "community",
    navigationClick: 1,
    qualifiedReadRate: 0.5,
    referrerHost: "",
    source: "discord-community",
    updatesClick: 1,
    updatesGuideRate: 0.5,
    ...overrides
  };
}

describe("AnalyticsDistribution", () => {
  it("shows measured distribution outcomes with readable article and medium labels", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsDistribution, {
      articles: [article],
      sources: [
        source(),
        source({
          article50: 1,
          articleEnd: 1,
          landing: 2,
          navigationClick: 0,
          referrerHost: "community.example",
          updatesClick: 0
        }),
        source({ campaign: "article_share", content: "copy", source: "noema_reader" })
      ]
    }));

    expect(html).toContain("配信元ごとに、どの記事が読まれたか");
    expect(html).toContain("discord-community");
    expect(html).toContain("コミュニティ");
    expect(html).toContain("コーディングエージェントとは何か");
    expect(html).toContain("what-is-coding-agent");
    expect(html).toContain("66.7%");
    expect(html).toContain("50%");
    expect(html.match(/discord-community/gu)).toHaveLength(1);
    expect(html).not.toContain("community.example");
    expect(html).not.toContain("noema_reader");
    expect(html).toContain("読者単位の転換率ではありません");
  });

  it("keeps an unknown content value visible and explains the empty state", () => {
    const unknownHtml = renderToStaticMarkup(createElement(AnalyticsDistribution, {
      articles: [],
      sources: [source({ content: "unmatched-article", medium: "partner" })]
    }));
    const emptyHtml = renderToStaticMarkup(createElement(AnalyticsDistribution, {
      articles: [article],
      sources: []
    }));

    expect(unknownHtml).toContain("unmatched-article");
    expect(unknownHtml).toContain("提携・紹介");
    expect(emptyHtml).toContain("この期間の配信用リンクからの到達はまだありません");
    expect(emptyHtml).toContain("公開済み記事の編集画面でリンクを作り");
  });
});
