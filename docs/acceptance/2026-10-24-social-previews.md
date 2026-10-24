# Article social previews

## Design

Article links previously used the editorial hero image, or the generic site image when there was no hero. Article cards now generate a 1200 × 630 PNG from the published title and primary topic. Ivory background, dark title, green Noema wordmark/edge, and an explicit 記事 badge distinguish them from the existing シリーズ images. The image omits the description to keep the title legible at small sizes; the HTML metadata retains the article description. Social titles omit the redundant `| Noema` suffix (browser titles retain it).

Japanese word segmentation avoids splitting words unnecessarily. Titles occupy at most three lines, with ellipsis for unusually long content. Full titles remain in metadata and image alt text. Images are independent of editorial hero dimensions and support articles without hero images.

## Delivery

The route reads the existing publication repository; absent/unpublished articles return 404. Unlisted articles follow their existing URL visibility and use private/no-store images. A version derived from the displayed content and design revision changes on title/topic edits. Public images have a one-hour cache lifetime. Rendering failures fall back through the ASSETS binding with no-store, including errors raised while consuming the render stream. No remote image or font host is required.

Images use the article serving origin so develop can be verified before production promotion. Canonical page URLs remain production URLs. The SEO verifier permits only the exact article image path on that serving origin; unrelated image origins remain invalid.

## Evidence

- Local built Wrangler preview, 50 article HTML responses with Twitterbot UA and 50 image responses with Discordbot UA: HTTP 200, PNG 1200 × 630, maximum 43,459 bytes; slowest combined HTML/image fetch 196 ms locally. This is not an edge latency guarantee.
- Actual PNG inspected after correcting the Japanese break between 仕組 and み. Existing series image design retained.
- Unit coverage: content-version changes, long Japanese/Latin titles, Japanese word boundaries, missing publications, unlisted caching, and asynchronous rendering failure fallback.
- Blog type checks, test suites, production build, and deployment route validation run locally.
- No messages were posted to X or Discord; crawler HTTP checks and image inspection do not certify those apps' actual layout or cache freshness.

## References

- Discord official link-preview documentation: https://github.com/discord/discord-api-docs/blob/main/developers/link-previews/overview.mdx (server-rendered metadata, image dimensions, large-image card, cache behavior).
- Cloudflare official Workers guidance: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ (binding-based asset access and error handling).
