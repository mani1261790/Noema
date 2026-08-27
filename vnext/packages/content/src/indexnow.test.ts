import { describe, expect, it, vi } from "vitest";
import {
  NOEMA_INDEXNOW_ENDPOINT,
  NOEMA_INDEXNOW_KEY,
  NOEMA_INDEXNOW_KEY_PATH,
  createNoemaIndexNowSubmission,
  noemaIndexNowUrlsForPublicationChange,
  submitNoemaIndexNow
} from "./indexnow";

const publicArticle = {
  publicationStatus: "published",
  publishedSlug: "before-title",
  publishedVisibility: "public",
  topics: ["development-environment"]
};

describe("IndexNow discovery notifications", () => {
  it("includes changed public article and discovery surfaces", () => {
    expect(noemaIndexNowUrlsForPublicationChange(
      publicArticle,
      { ...publicArticle, publishedSlug: "after-title", topics: ["data-models"] }
    )).toEqual([
      "https://noema-learn.uk/",
      "https://noema-learn.uk/articles/",
      "https://noema-learn.uk/sitemap.xml",
      "https://noema-learn.uk/articles/before-title/",
      "https://noema-learn.uk/topics/development-environment/",
      "https://noema-learn.uk/articles/after-title/",
      "https://noema-learn.uk/topics/data-models/"
    ]);
  });

  it("notifies the former public URL when publication ends", () => {
    expect(noemaIndexNowUrlsForPublicationChange(
      publicArticle,
      { ...publicArticle, publicationStatus: "archived" }
    )).toContain("https://noema-learn.uk/articles/before-title/");
  });

  it("does not submit private publication changes", () => {
    const unlisted = { ...publicArticle, publishedVisibility: "unlisted" };
    expect(noemaIndexNowUrlsForPublicationChange(unlisted, unlisted)).toEqual([]);
  });

  it("builds a bounded same-origin payload", () => {
    const payload = createNoemaIndexNowSubmission([
      "https://noema-learn.uk/articles/example/",
      "https://noema-learn.uk/articles/example/"
    ]);
    expect(payload).toEqual({
      host: "noema-learn.uk",
      key: NOEMA_INDEXNOW_KEY,
      keyLocation: `https://noema-learn.uk${NOEMA_INDEXNOW_KEY_PATH}`,
      urlList: ["https://noema-learn.uk/articles/example/"]
    });
    expect(() => createNoemaIndexNowSubmission(["https://example.com/"]))
      .toThrow("indexnow_url_outside_noema");
  });

  it("accepts received and pending-validation responses", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(submitNoemaIndexNow(
      ["https://noema-learn.uk/articles/example/"],
      fetcher
    )).resolves.toEqual({ status: 202, urlCount: 1 });
    expect(fetcher).toHaveBeenCalledWith(NOEMA_INDEXNOW_ENDPOINT, expect.objectContaining({
      method: "POST"
    }));
  });

  it("rejects failed protocol responses without exposing response content", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("upstream detail", { status: 429 }));
    await expect(submitNoemaIndexNow(
      ["https://noema-learn.uk/articles/example/"],
      fetcher
    )).rejects.toThrow("indexnow_submission_failed:429");
  });
});
