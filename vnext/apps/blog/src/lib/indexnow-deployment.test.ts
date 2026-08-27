import { describe, expect, it, vi } from "vitest";
import {
  NOEMA_INDEXNOW_ENDPOINT,
  NOEMA_INDEXNOW_KEY_PATH
} from "@noema/content/indexnow";
import {
  extractSitemapUrls,
  submitPublicSitemap,
  verifyPublishedIndexNowKey
} from "../../scripts/submit-indexnow";

describe("IndexNow deployment helper", () => {
  it("extracts and decodes sitemap locations in document order", () => {
    expect(extractSitemapUrls(`<?xml version="1.0"?>
      <urlset>
        <url><loc>https://noema-learn.uk/</loc></url>
        <url><loc>https://noema-learn.uk/articles/?a=1&amp;b=2</loc></url>
      </urlset>`)).toEqual([
        "https://noema-learn.uk/",
        "https://noema-learn.uk/articles/?a=1&b=2"
    ]);
  });

  it("verifies the key at a deployed origin", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("f1af5e83c536073292fb9103ce6ac661\n", { status: 200 })
    );
    await expect(verifyPublishedIndexNowKey("https://preview.example.com", fetcher))
      .resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://preview.example.com/f1af5e83c536073292fb9103ce6ac661.txt")
    );
  });

  it("deduplicates and submits large sitemaps in bounded batches without another key check", async () => {
    const urls = Array.from(
      { length: 10_001 },
      (_, index) => `https://noema-learn.uk/articles/article-${index}/`
    );
    const sitemap = `<urlset>${[...urls, urls[0]].map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(sitemap, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(submitPublicSitemap(fetcher)).resolves.toEqual({ status: 202, urlCount: 10_001 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toEqual(new URL("https://noema-learn.uk/sitemap.xml"));
    expect(fetcher.mock.calls.some(([input]) => String(input).endsWith(NOEMA_INDEXNOW_KEY_PATH)))
      .toBe(false);
    const submissions = fetcher.mock.calls.slice(1).map(([input, init]) => ({
      input,
      payload: JSON.parse(String(init?.body)) as { urlList: string[] }
    }));
    expect(submissions.map(({ input }) => input)).toEqual([
      NOEMA_INDEXNOW_ENDPOINT,
      NOEMA_INDEXNOW_ENDPOINT
    ]);
    expect(submissions.map(({ payload }) => payload.urlList.length)).toEqual([10_000, 1]);
  });
});
