import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsOnwardPaths } from "../src/CmsAnalyticsDashboard";

describe("AnalyticsOnwardPaths", () => {
  it("shows the anonymous source-to-target path and the truncation boundary", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsOnwardPaths, {
      paths: [{
        clickCount: 3,
        navigationKind: "related",
        sourceArticleId: "11111111-1111-4111-8111-111111111111",
        sourceRevisionNumber: 4,
        sourceSlug: "source-article",
        sourceTitle: "出発記事",
        targetSlug: "target-article",
        targetTitle: "移動先記事"
      }],
      truncated: true
    }));

    expect(html).toContain("次にどの記事へ進んだか");
    expect(html).toContain("読者やセッションを結合せず");
    expect(html).toContain("上位200件");
    expect(html).toContain("出発記事");
    expect(html).toContain("関連記事");
    expect(html).toContain("移動先記事");
    expect(html).toContain("source-article・rev.4");
    expect(html).toContain("target-article");
  });
});
