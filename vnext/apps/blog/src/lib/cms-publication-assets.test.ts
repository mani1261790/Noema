import { describe, expect, it, vi } from "vitest";
import {
  isArticleAssetKey,
  isAssetReferencedByPublishedArticle
} from "./cms-publication-assets";

describe("CMS publication assets", () => {
  it("accepts only immutable article asset keys", () => {
    expect(isArticleAssetKey("articles/00000000-0000-4000-8000-000000000000.webp")).toBe(true);
    expect(isArticleAssetKey("../secret.png")).toBe(false);
    expect(isArticleAssetKey("articles/draft.svg")).toBe(false);
  });

  it("checks the pinned published revision for the exact asset path", async () => {
    const first = vi.fn().mockResolvedValue({ found: 1 });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });

    await expect(isAssetReferencedByPublishedArticle(
      { prepare },
      "/media/articles/00000000-0000-4000-8000-000000000000.png"
    )).resolves.toBe(true);
    expect(bind).toHaveBeenCalledWith(
      "/media/articles/00000000-0000-4000-8000-000000000000.png"
    );
  });
});
