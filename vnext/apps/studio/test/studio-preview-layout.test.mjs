import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studioCss = readFileSync(new URL("../src/studio.css", import.meta.url), "utf8");
const articleCss = readFileSync(new URL("../../../packages/ui/src/styles/article.css", import.meta.url), "utf8");

test("applies the preview sheet to the complete shared presentation", () => {
  assert.match(studioCss, /\.studio-preview \.article-presentation\s*\{/);
  assert.match(studioCss, /\.studio-live-preview \.article-presentation\s*\{/);
  assert.doesNotMatch(studioCss, /\.studio-(?:live-)?preview\s+article\s*\{/);
});

test("separates only the second and later authored h2 headings", () => {
  assert.doesNotMatch(articleCss, /\.article-body h2\s*\{[^}]*border-/s);
  assert.match(
    articleCss,
    /\.article-body > h2 ~ h2\s*\{[^}]*border-top:\s*1px solid var\(--noema-border\);/s,
  );
  assert.doesNotMatch(articleCss, /\.article-body\s*>?\s*h3[^{}]*\{[^}]*border-/s);
});
