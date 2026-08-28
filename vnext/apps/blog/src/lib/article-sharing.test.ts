import { describe, expect, it, vi } from "vitest";
import {
  addSeriesShareAttributionToArticleUrl,
  createArticleShareData,
  createSeriesShareData,
  shareArticle,
  supportsNativeSharing,
  type ArticleShareData,
} from "./article-sharing";

const shareData: ArticleShareData = {
  title: "AIエージェント入門",
  url: "https://noema-learn.uk/articles/ai-agent?utm_source=noema_reader&utm_medium=share&utm_campaign=article_share&utm_content=native",
};

describe("article sharing", () => {
  it("uses the canonical URL and removes the site-name suffix from the title", () => {
    expect(createArticleShareData({
      canonicalUrl: "https://noema-learn.uk/articles/ai-agent",
      fallbackUrl: "https://noema-learn.uk/articles/ai-agent?utm_source=test",
      method: "native",
      title: "AIエージェント入門 | Noema",
    })).toEqual(shareData);
  });

  it("falls back to the current path without carrying incoming attribution forward", () => {
    expect(createArticleShareData({
      fallbackUrl: "https://noema-learn.uk/preview/article?utm_source=incoming#section",
      method: "copy",
      title: "記事プレビュー",
    }).url).toBe(
      "https://noema-learn.uk/preview/article?utm_source=noema_reader&utm_medium=share&utm_campaign=article_share&utm_content=copy",
    );
  });

  it("creates a series share URL with a distinct campaign", () => {
    expect(createSeriesShareData({
      canonicalUrl: "https://noema-learn.uk/series/start-ai-development",
      fallbackUrl: "https://noema-learn.uk/series/start-ai-development?utm_source=incoming#articles",
      method: "copy",
      title: "はじめよう、AI駆動開発 | Noema",
    })).toEqual({
      title: "はじめよう、AI駆動開発",
      url: "https://noema-learn.uk/series/start-ai-development?utm_source=noema_reader&utm_medium=share&utm_campaign=series_share&utm_content=copy",
    });
  });

  it("carries bounded series-share attribution to canonical article links", () => {
    expect(addSeriesShareAttributionToArticleUrl({
      articleUrl: "/articles/what-is-coding-agent",
      seriesLandingUrl: "https://noema-learn.uk/series/start-ai-development?utm_source=noema_reader&utm_medium=share&utm_campaign=series_share&utm_content=native&utm_term=ignored",
    })).toBe(
      "https://noema-learn.uk/articles/what-is-coding-agent?utm_source=noema_reader&utm_medium=share&utm_campaign=series_share&utm_content=native",
    );
  });

  it("does not attribute arbitrary campaigns or non-canonical article links", () => {
    const validLanding = "https://noema-learn.uk/series/start-ai-development?utm_source=noema_reader&utm_medium=share&utm_campaign=series_share&utm_content=copy";
    expect(addSeriesShareAttributionToArticleUrl({
      articleUrl: "https://example.com/articles/what-is-coding-agent",
      seriesLandingUrl: validLanding,
    })).toBe("https://example.com/articles/what-is-coding-agent");
    expect(addSeriesShareAttributionToArticleUrl({
      articleUrl: "/articles/what-is-coding-agent?preview=1",
      seriesLandingUrl: validLanding,
    })).toBe("/articles/what-is-coding-agent?preview=1");
    expect(addSeriesShareAttributionToArticleUrl({
      articleUrl: "/articles/what-is-coding-agent",
      seriesLandingUrl: validLanding.replace("series_share", "other_campaign"),
    })).toBe("/articles/what-is-coding-agent");
  });

  it("reports native share availability", () => {
    expect(supportsNativeSharing({ share: vi.fn() })).toBe(true);
    expect(supportsNativeSharing({})).toBe(false);
  });

  it("reports a completed native share", async () => {
    const navigatorLike = { share: vi.fn().mockResolvedValue(undefined) };

    await expect(shareArticle(navigatorLike, shareData)).resolves.toBe("shared");
    expect(navigatorLike.share).toHaveBeenCalledWith(shareData);
  });

  it("treats closing the share sheet as a dismissal instead of an error", async () => {
    const dismissal = new Error("share dismissed");
    dismissal.name = "AbortError";

    await expect(shareArticle({
      share: vi.fn().mockRejectedValue(dismissal),
    }, shareData)).resolves.toBe("dismissed");
  });

  it("distinguishes failures and unsupported browsers", async () => {
    await expect(shareArticle({
      share: vi.fn().mockRejectedValue(new Error("share failed")),
    }, shareData)).resolves.toBe("failed");
    await expect(shareArticle({}, shareData)).resolves.toBe("unavailable");
  });
});
