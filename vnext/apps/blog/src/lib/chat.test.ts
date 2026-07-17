import { previewArticles, previewArticleMarkdown } from "@noema/content";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishedArticleBySlug } from "./cms-publications";
import { resolveChatArticle } from "../pages/api/chat";

vi.mock("./cms-publications", () => ({
  getPublishedArticleBySlug: vi.fn()
}));

const loadPublishedArticle = vi.mocked(getPublishedArticleBySlug);
const collidingPreviewArticle = previewArticles[0];

beforeEach(() => {
  loadPublishedArticle.mockReset();
});

describe("resolveChatArticle", () => {
  it("prefers a D1 publication when its slug collides with a preview fixture", async () => {
    const publishedData = {
      ...collidingPreviewArticle,
      description: "D1に保存された公開記事です。",
      status: "published" as const,
      title: "CMSの公開記事"
    };
    loadPublishedArticle.mockResolvedValue({
      data: publishedData,
      markdown: "## CMS本文\n\nD1のpublished revisionです。",
      publishedAt: "2026-07-18T00:00:00.000Z",
      revisionNumber: 3,
      visibility: "public"
    });

    const result = await resolveChatArticle(collidingPreviewArticle.slug, false);

    expect(loadPublishedArticle).toHaveBeenCalledWith(collidingPreviewArticle.slug);
    expect(result).toEqual({
      article: publishedData,
      markdown: "## CMS本文\n\nD1のpublished revisionです。"
    });
    expect(result?.markdown).not.toBe(previewArticleMarkdown);
  });

  it("does not fall back to a preview fixture for a normal article request", async () => {
    loadPublishedArticle.mockResolvedValue(null);

    const result = await resolveChatArticle(collidingPreviewArticle.slug, false);

    expect(loadPublishedArticle).toHaveBeenCalledWith(collidingPreviewArticle.slug);
    expect(result).toBeNull();
  });

  it("uses a preview fixture only when the request explicitly selects preview mode", async () => {
    const result = await resolveChatArticle(collidingPreviewArticle.slug, true);

    expect(loadPublishedArticle).not.toHaveBeenCalled();
    expect(result).toEqual({
      article: collidingPreviewArticle,
      markdown: previewArticleMarkdown
    });
  });
});
