import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArticlePaths,
  parseCmsArticleImages,
} from "./verify-article-image-dimensions.mjs";

test("parseArticlePaths returns unique canonical article paths", () => {
  assert.deepEqual(parseArticlePaths([
    '<a href="/articles/first">First</a>',
    '<a href="/articles/second/">Second</a>',
    '<a href="/articles/first">First again</a>',
  ].join("")), ["/articles/first", "/articles/second"]);
});

test("parseCmsArticleImages returns dimensions only for CMS media", () => {
  assert.deepEqual(parseCmsArticleImages([
    '<img src="/media/articles/00000000-0000-4000-8000-000000000000.png" alt="図" width="1200" height="675">',
    '<img src="https://example.com/media/articles/00000000-0000-4000-8000-000000000000.png" width="1" height="1">',
    '<img src="/logo.svg" width="64" height="64">',
  ].join("")), [{
    height: 675,
    path: "/media/articles/00000000-0000-4000-8000-000000000000.png",
    width: 1200,
  }]);
});

test("parseCmsArticleImages exposes a missing dimension", () => {
  assert.deepEqual(parseCmsArticleImages(
    '<img src="/media/articles/00000000-0000-4000-8000-000000000000.webp" alt="図">',
  ), [{
    height: null,
    path: "/media/articles/00000000-0000-4000-8000-000000000000.webp",
    width: null,
  }]);
});
