import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectSeoDocument,
  parseSitemap,
  validateSeoDocument,
} from "./verify-public-seo.mjs";

const articleUrl = "https://noema-learn.uk/articles/example";
const homepageUrl = "https://noema-learn.uk/";

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
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="テスト記事 | Noema">
    <meta name="twitter:description" content="重複しないテスト記事の説明です。">
    <meta name="twitter:image" content="https://noema-learn.uk/og/example.png">
    <script type="application/ld+json">{"@type":"BlogPosting"}</script>
    <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    ${overrides}
  </head><body><h1>テスト記事</h1><img src="/example.png" alt="説明"></body></html>`;
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
