import { describe, expect, it, vi } from "vitest";
import {
  getCmsArticleAssetDimensions,
  getPublishedArticleAssetMetadata,
  isArticleAssetKey,
  recordCmsAssetDimensions,
} from "./cms-publication-assets";

describe("CMS publication assets", () => {
  it("accepts only immutable article asset keys", () => {
    expect(isArticleAssetKey("articles/00000000-0000-4000-8000-000000000000.webp")).toBe(true);
    expect(isArticleAssetKey("../secret.png")).toBe(false);
    expect(isArticleAssetKey("articles/draft.svg")).toBe(false);
  });

  it("checks the pinned published revision and returns its stored dimensions", async () => {
    const first = vi.fn().mockResolvedValue({ height: 675, width: 1200 });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });

    await expect(getPublishedArticleAssetMetadata(
      { prepare },
      "/media/articles/00000000-0000-4000-8000-000000000000.png"
    )).resolves.toEqual({ dimensions: { height: 675, width: 1200 } });
    expect(bind).toHaveBeenCalledWith(
      "articles/00000000-0000-4000-8000-000000000000.png",
      "/media/articles/00000000-0000-4000-8000-000000000000.png"
    );
  });

  it("keeps a published asset deliverable while its dimensions are awaiting backfill", async () => {
    const first = vi.fn().mockResolvedValue({ height: null, width: null });
    const bind = vi.fn().mockReturnValue({ first });
    await expect(getPublishedArticleAssetMetadata(
      { prepare: vi.fn().mockReturnValue({ bind }) },
      "/media/articles/00000000-0000-4000-8000-000000000000.png",
    )).resolves.toEqual({ dimensions: null });
  });

  it("resolves only valid local article asset dimensions", async () => {
    const all = vi.fn().mockResolvedValue({ results: [{
      height: 675,
      r2_key: "articles/00000000-0000-4000-8000-000000000000.png",
      width: 1200,
    }] });
    const bind = vi.fn().mockReturnValue({ all });
    const dimensions = await getCmsArticleAssetDimensions(
      { prepare: vi.fn().mockReturnValue({ bind }) },
      [
        "/media/articles/00000000-0000-4000-8000-000000000000.png",
        "https://example.com/media/articles/00000000-0000-4000-8000-000000000000.png",
      ],
    );
    expect(dimensions).toEqual(new Map([[
      "/media/articles/00000000-0000-4000-8000-000000000000.png",
      { height: 675, width: 1200 },
    ]]));
  });

  it("records a missing dimension pair against an exact immutable key", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn().mockReturnValue({ run });
    await recordCmsAssetDimensions(
      { prepare: vi.fn().mockReturnValue({ bind }) },
      "articles/00000000-0000-4000-8000-000000000000.png",
      { height: 675, width: 1200 },
    );
    expect(bind).toHaveBeenCalledWith(
      1200,
      675,
      "articles/00000000-0000-4000-8000-000000000000.png",
    );
    expect(run).toHaveBeenCalledOnce();
  });
});
