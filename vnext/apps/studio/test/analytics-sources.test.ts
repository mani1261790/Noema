import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_INDEX_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_LINKS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_SITEMAPS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_URL
} from "@noema/cms";
import { AnalyticsSources } from "../src/CmsAnalyticsDashboard";

describe("AnalyticsSources", () => {
  it("opens Cloudflare Web Analytics with public-host and bot filters", () => {
    const url = new URL(CMS_CLOUDFLARE_WEB_ANALYTICS_URL);

    expect(url.searchParams.get("excludeBots")).toBe("Yes");
    expect(url.searchParams.get("host")).toBe("noema-learn.uk");
  });

  it("distinguishes integrated and external sources with source-specific links", () => {
    const html = renderToStaticMarkup(createElement(AnalyticsSources, {
      sources: [
        {
          id: "noema_reader_events",
          role: "記事内行動",
          status: "active"
        },
        {
          accessUrl: CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
          id: "cloudflare_web_analytics",
          role: "Core Web Vitals",
          status: "external"
        },
        {
          accessUrl: CMS_GOOGLE_SEARCH_CONSOLE_URL,
          id: "google_search_console",
          role: "検索パフォーマンス",
          status: "external"
        }
      ]
    }));

    expect(html).toContain("接続中");
    expect(html).toContain("外部で確認");
    expect(html).not.toContain("未接続");
    expect(html).toContain(`href="${CMS_CLOUDFLARE_WEB_ANALYTICS_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="${CMS_GOOGLE_SEARCH_CONSOLE_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="${CMS_GOOGLE_SEARCH_CONSOLE_INDEX_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="${CMS_GOOGLE_SEARCH_CONSOLE_SITEMAPS_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`href="${CMS_GOOGLE_SEARCH_CONSOLE_LINKS_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("Web Analyticsで確認");
    expect(html).toContain("検索実績");
    expect(html).toContain("インデックス状況");
    expect(html).toContain("サイトマップ");
    expect(html).toContain("外部リンク");
    expect(html).toContain("（新しいタブ）");
    expect(html.match(/target="_blank"/gu)).toHaveLength(5);
  });
});
