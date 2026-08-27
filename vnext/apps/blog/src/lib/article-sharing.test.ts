import { describe, expect, it, vi } from "vitest";
import {
  createArticleShareData,
  shareArticle,
  supportsNativeSharing,
  type ArticleShareData,
} from "./article-sharing";

const shareData: ArticleShareData = {
  title: "AIエージェント入門",
  url: "https://noema-learn.uk/articles/ai-agent",
};

describe("article sharing", () => {
  it("uses the canonical URL and removes the site-name suffix from the title", () => {
    expect(createArticleShareData({
      canonicalUrl: "https://noema-learn.uk/articles/ai-agent",
      fallbackUrl: "https://noema-learn.uk/articles/ai-agent?utm_source=test",
      title: "AIエージェント入門 | Noema",
    })).toEqual(shareData);
  });

  it("falls back to the current URL when a canonical URL is unavailable", () => {
    expect(createArticleShareData({
      fallbackUrl: "https://noema-learn.uk/preview/article",
      title: "記事プレビュー",
    }).url).toBe("https://noema-learn.uk/preview/article");
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
