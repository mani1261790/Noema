import assert from "node:assert/strict";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import {
  inspectSeoDocument,
  parsePngDimensions,
  parseRssFeed,
  parseSitemap,
  validateOgImageAsset,
  validateRssFeed,
  validateSeoDocument,
} from "./verify-public-seo.mjs";

const articleUrl = "https://noema-learn.uk/articles/example";
const homepageUrl = "https://noema-learn.uk/";
const seriesUrl = "https://noema-learn.uk/series/learning-path";
const seriesImageUrl = "https://noema-learn.uk/og/series/learning-path.png?v=1234abcd";

function articleHtml(overrides = "") {
  return `<!doctype html>
  <html lang="ja"><head>
    <title>テスト記事 | Noema</title>
    <meta name="description" content="重複しないテスト記事の説明です。">
    <meta name="robots" content="index,follow,max-image-preview:large">
    <link rel="canonical" href="${articleUrl}">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    <meta property="og:title" content="テスト記事 | Noema">
    <meta property="og:description" content="重複しないテスト記事の説明です。">
    <meta property="og:url" content="${articleUrl}">
    <meta property="og:image" content="https://noema-learn.uk/og/example.png">
    <meta property="og:image:alt" content="テスト記事">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="テスト記事 | Noema">
    <meta name="twitter:description" content="重複しないテスト記事の説明です。">
    <meta name="twitter:image" content="https://noema-learn.uk/og/example.png">
    <meta name="twitter:image:alt" content="テスト記事">
    <script type="application/ld+json">{"@type":"BlogPosting"}</script>
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    ${overrides}
  </head><body><h1>テスト記事</h1><img src="/example.png" alt="説明"></body></html>`;
}

function seriesHtml() {
  return `<!doctype html>
  <html lang="ja"><head>
    <title>AI開発を始める | Noema</title>
    <meta name="description" content="AI開発を順番に学ぶシリーズです。">
    <meta name="robots" content="index,follow,max-image-preview:large">
    <link rel="canonical" href="${seriesUrl}">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    <meta property="og:title" content="AI開発を始める | Noema">
    <meta property="og:description" content="AI開発を順番に学ぶシリーズです。">
    <meta property="og:url" content="${seriesUrl}">
    <meta property="og:image" content="${seriesImageUrl}">
    <meta property="og:image:alt" content="AI開発を始める。全2本の記事を順番に読めるNoemaのシリーズ">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="AI開発を始める | Noema">
    <meta name="twitter:description" content="AI開発を順番に学ぶシリーズです。">
    <meta name="twitter:image" content="${seriesImageUrl}">
    <meta name="twitter:image:alt" content="AI開発を始める。全2本の記事を順番に読めるNoemaのシリーズ">
    <script type="application/ld+json">{"@type":"CollectionPage","url":"${seriesUrl}","primaryImageOfPage":{"@type":"ImageObject","url":"${seriesImageUrl}","contentUrl":"${seriesImageUrl}","width":1200,"height":630},"mainEntity":{"@type":"ItemList","numberOfItems":2,"itemListElement":[{"@type":"ListItem","position":1},{"@type":"ListItem","position":2}]}}</script>
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
  </head><body><h1>AI開発を始める</h1></body></html>`;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, data.length + 8);
  return chunk;
}

function pngImage(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  const pixels = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function homepageHtml(alternateName = "noema-learn.uk") {
  return articleHtml().replaceAll(articleUrl, homepageUrl)
    .replace('{"@type":"BlogPosting"}', `{"@graph":[{"@type":"Organization"},{"@type":"WebSite","name":"Noema","alternateName":"${alternateName}","url":"${homepageUrl}"}]}`);
}

test("parseSitemap keeps canonical URLs with valid lastmod dates", () => {
  assert.deepEqual(parseSitemap(`<?xml version="1.0"?><urlset>
    <url><loc>https://noema-learn.uk/</loc><lastmod>2026-08-28</lastmod></url>
    <url><loc>https://noema-learn.uk/articles/example</loc><lastmod>2026-08-27</lastmod></url>
  </urlset>`), [
    { lastModified: "2026-08-28", url: "https://noema-learn.uk/" },
    { lastModified: "2026-08-27", url: articleUrl },
  ]);
});

test("parseSitemap rejects duplicates and noncanonical origins", () => {
  assert.throws(() => parseSitemap(`<urlset>
    <url><loc>https://example.com/a</loc><lastmod>2026-08-28</lastmod></url>
    <url><loc>https://example.com/a</loc><lastmod>yesterday</lastmod></url>
  </urlset>`), /outside https:\/\/noema-learn\.uk[\s\S]*duplicate sitemap URL[\s\S]*YYYY-MM-DD/u);
});

test("validateRssFeed accepts canonical article links and matching permanent GUIDs", () => {
  const sitemap = parseSitemap(`<?xml version="1.0"?><urlset>
    <url><loc>https://noema-learn.uk/</loc><lastmod>2026-08-28</lastmod></url>
    <url><loc>https://noema-learn.uk/articles/example</loc><lastmod>2026-08-27</lastmod></url>
  </urlset>`);
  const feed = parseRssFeed(`<?xml version="1.0"?><rss><channel>
    <title>Noema</title><link>https://noema-learn.uk/</link>
    <item><title>Example</title><link>${articleUrl}</link><guid isPermaLink="true">${articleUrl}</guid></item>
  </channel></rss>`);

  assert.deepEqual(validateRssFeed(feed, sitemap), []);
  assert.deepEqual(feed.items, [{
    guid: articleUrl,
    guidIsPermaLink: true,
    link: articleUrl,
  }]);
});

test("validateRssFeed rejects redirecting links, mismatched GUIDs, and missing articles", () => {
  const sitemap = parseSitemap(`<?xml version="1.0"?><urlset>
    <url><loc>https://noema-learn.uk/articles/example</loc><lastmod>2026-08-27</lastmod></url>
  </urlset>`);
  const feed = parseRssFeed(`<?xml version="1.0"?><rss><channel>
    <link>https://noema-learn.uk</link>
    <item><link>${articleUrl}/</link><guid isPermaLink="false">${articleUrl}/old</guid></item>
  </channel></rss>`);
  const errors = validateRssFeed(feed, sitemap);

  assert.ok(errors.some((error) => error.includes("channel link")));
  assert.ok(errors.some((error) => error.includes("not a canonical public article URL")));
  assert.ok(errors.some((error) => error.includes("GUID does not match")));
  assert.ok(errors.some((error) => error.includes("isPermaLink=true")));
  assert.ok(errors.some((error) => error.includes("missing from RSS")));
});

test("inspectSeoDocument accepts a complete article document", () => {
  const document = inspectSeoDocument(articleHtml(), articleUrl);
  assert.deepEqual(validateSeoDocument(document, articleUrl), []);
  assert.deepEqual([...document.schemaTypes].sort(), ["BlogPosting", "BreadcrumbList"]);
});

test("validateSeoDocument requires the unique site-name fallback on the homepage", () => {
  const complete = inspectSeoDocument(homepageHtml(), homepageUrl);
  assert.deepEqual(validateSeoDocument(complete, homepageUrl), []);
  assert.deepEqual(complete.websites.map((website) => website.alternateName), ["noema-learn.uk"]);

  const errors = validateSeoDocument(
    inspectSeoDocument(homepageHtml("Noema Learn"), homepageUrl),
    homepageUrl,
  );
  assert.ok(errors.includes("WebSite alternateName must include noema-learn.uk."));
});

test("validateSeoDocument reports indexability and presentation regressions together", () => {
  const html = articleHtml()
    .replace('lang="ja"', 'lang="en"')
    .replace("index,follow,max-image-preview:large", "noindex,nofollow")
    .replace(' alt="説明"', "")
    .replace('{"@type":"BlogPosting"}', "{invalid");
  const errors = validateSeoDocument(inspectSeoDocument(html, articleUrl), articleUrl);
  assert.ok(errors.some((error) => error.includes("html lang")));
  assert.ok(errors.some((error) => error.includes("robots")));
  assert.ok(errors.some((error) => error.includes("omit alt")));
  assert.ok(errors.some((error) => error.includes("invalid JSON-LD")));
  assert.ok(errors.some((error) => error.includes("BlogPosting")));
});

test("validateSeoDocument cross-checks series metadata, structured data, and public item count", () => {
  const complete = inspectSeoDocument(seriesHtml(), seriesUrl);
  assert.deepEqual(validateSeoDocument(complete, seriesUrl), []);

  const inconsistent = seriesHtml()
    .replace('content="1200"', 'content="1199"')
    .replace('"numberOfItems":2', '"numberOfItems":3');
  const errors = validateSeoDocument(inspectSeoDocument(inconsistent, seriesUrl), seriesUrl);
  assert.ok(errors.some((error) => error.includes("og:image:width")));
  assert.ok(errors.some((error) => error.includes("declares 3 item(s) but contains 2")));
  assert.ok(errors.some((error) => error.includes("series image alt")));

  const wrongCollection = seriesHtml().replace(
    `"url":"${seriesUrl}"`,
    '"url":"https://noema-learn.uk/series/other"',
  );
  const wrongCollectionErrors = validateSeoDocument(inspectSeoDocument(wrongCollection, seriesUrl), seriesUrl);
  assert.ok(wrongCollectionErrors.some((error) => error.includes("canonical URL is missing")));
});

test("validateOgImageAsset accepts a generated 1200x630 series PNG with durable success headers", () => {
  const body = pngImage(1200, 630);
  const headers = new Headers({
    "cache-control": "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400",
    "content-type": "image/png",
    "x-content-type-options": "nosniff",
  });

  assert.deepEqual(parsePngDimensions(body), { height: 630, width: 1200 });
  assert.deepEqual(validateOgImageAsset(seriesImageUrl, headers, body), []);
});

test("validateOgImageAsset rejects a series fallback or malformed social image", () => {
  const errors = validateOgImageAsset(seriesImageUrl, new Headers({
    "cache-control": "no-store",
    "content-type": "image/png",
  }), pngImage(800, 418));

  assert.ok(errors.some((error) => error.includes("nosniff")));
  assert.ok(errors.some((error) => error.includes("missing public")));
  assert.ok(errors.some((error) => error.includes("no-store fallback")));
  assert.ok(errors.some((error) => error.includes("800x418")));

  const truncated = pngImage(1200, 630).subarray(0, 24);
  assert.equal(parsePngDimensions(truncated), null);
  assert.ok(validateOgImageAsset(seriesImageUrl, new Headers({
    "cache-control": "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400",
    "content-type": "image/png",
    "x-content-type-options": "nosniff",
  }), truncated).some((error) => error.includes("not a readable PNG")));
});
