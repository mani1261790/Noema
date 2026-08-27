import { describe, expect, it, vi } from "vitest";
import {
  extractSitemapUrls,
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
});
