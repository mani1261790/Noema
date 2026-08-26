import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExpectedArticlePaths,
  parseRenderedArticlePaths,
  verifyCmsPublicationParity,
} from "./verify-cms-publication-parity.mjs";

const d1Output = [{
  results: [
    { published_slug: "first-article" },
    { published_slug: "second-article" },
  ],
  success: true,
}];

test("matches every rendered environment to the D1 public publication set", () => {
  const html = '<a href="/articles/first-article">First</a><a href="/articles/second-article/">Second</a>';
  assert.deepEqual(verifyCmsPublicationParity(d1Output, [
    { label: "development", html },
    { label: "production", html },
  ]), ["/articles/first-article", "/articles/second-article"]);
});

test("fails when both rendered environments silently omit a D1 publication", () => {
  const renderedPages = [
    { label: "development", html: "<main>No articles</main>" },
    { label: "production", html: "<main>No articles</main>" },
  ];
  assert.throws(
    () => verifyCmsPublicationParity(d1Output, renderedPages),
    /development does not match[\s\S]*Missing: \/articles\/first-article/u,
  );
});

test("fails when a rendered page contains an article outside the D1 publication set", () => {
  assert.throws(
    () => verifyCmsPublicationParity(d1Output, [{
      label: "production",
      html: '<a href="/articles/first-article"><a href="/articles/second-article"><a href="/articles/stale">',
    }]),
    /Unexpected: \/articles\/stale/u,
  );
});

test("rejects malformed or unsuccessful D1 output", () => {
  assert.throws(() => parseExpectedArticlePaths([]), /non-empty result array/u);
  assert.throws(() => parseExpectedArticlePaths([{ success: false, results: [] }]), /successful results array/u);
  assert.throws(
    () => parseExpectedArticlePaths([{ success: true, results: [{ published_slug: "Not Canonical" }] }]),
    /invalid published article slug/u,
  );
});

test("normalizes trailing slashes and de-duplicates rendered article links", () => {
  assert.deepEqual(
    parseRenderedArticlePaths('<a href="/articles/example/"><a href=\'/articles/example\'>'),
    ["/articles/example"],
  );
});
