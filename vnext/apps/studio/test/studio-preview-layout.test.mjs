import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studioCss = readFileSync(new URL("../src/studio.css", import.meta.url), "utf8");

test("applies the preview sheet to the complete shared presentation", () => {
  assert.match(studioCss, /\.studio-preview \.article-presentation\s*\{/);
  assert.match(studioCss, /\.studio-live-preview \.article-presentation\s*\{/);
  assert.doesNotMatch(studioCss, /\.studio-(?:live-)?preview\s+article\s*\{/);
});
