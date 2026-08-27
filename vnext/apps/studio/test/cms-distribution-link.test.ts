import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildMeasuredDistributionUrl,
  CmsDistributionLink,
  distributionSourceError,
  normalizeDistributionSource
} from "../src/CmsDistributionLink";

describe("measured distribution links", () => {
  it("normalizes a readable source into the existing analytics identifier contract", () => {
    expect(normalizeDistributionSource("  Discord Community  ")).toBe("discord-community");
    expect(normalizeDistributionSource("Ｂｌｕｅｓｋｙ")).toBe("bluesky");
    expect(distributionSourceError("discord-community")).toBeNull();
    expect(distributionSourceError("開発コミュニティ")).toContain("半角英小文字");
    expect(distributionSourceError("a".repeat(65))).toContain("64文字以内");
  });

  it("always creates a canonical production link with a fixed campaign taxonomy", () => {
    expect(buildMeasuredDistributionUrl({
      articleSlug: "what-is-coding-agent",
      medium: "community",
      source: " Discord Community "
    })).toBe(
      "https://noema-learn.uk/articles/what-is-coding-agent?utm_source=discord-community&utm_medium=community&utm_campaign=article_distribution&utm_content=what-is-coding-agent"
    );
  });

  it("rejects missing sources and noncanonical article slugs", () => {
    expect(buildMeasuredDistributionUrl({
      articleSlug: "what-is-coding-agent",
      medium: "social",
      source: ""
    })).toBeNull();
    expect(buildMeasuredDistributionUrl({
      articleSlug: "../preview/article",
      medium: "social",
      source: "bluesky"
    })).toBeNull();
  });

  it("explains the measurement and privacy boundary in the publishing workflow", () => {
    const html = renderToStaticMarkup(createElement(CmsDistributionLink, {
      articleSlug: "what-is-coding-agent"
    }));

    expect(html).toContain("配信用リンク");
    expect(html).toContain("配信元と方法をそろえる");
    expect(html).toContain("ソーシャル投稿");
    expect(html).toContain("コミュニティ");
    expect(html).toContain("入力内容はStudioに保存しません");
    expect(html).toContain("公開記事のURL名");
    expect(html).toContain("投稿文や読者IDは記録しません");
    expect(html).toContain("配信用リンクをコピー");
    expect(html).toContain("disabled");
  });
});
