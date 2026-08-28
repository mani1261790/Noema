import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const termsUrl = new URL("../src/pages/terms.astro", import.meta.url);
const footerUrl = new URL("../src/components/SiteFooter.astro", import.meta.url);

test("publishes current reader guidance instead of a pre-release placeholder", async () => {
  const [terms, footer] = await Promise.all([
    readFile(termsUrl, "utf8"),
    readFile(footerUrl, "utf8"),
  ]);

  assert.match(terms, /<h1>利用にあたって<\/h1>/);
  assert.match(terms, /記事アシスタント/);
  assert.match(terms, /OpenAI APIキー/);
  assert.match(terms, /href="\/privacy"/);
  assert.match(terms, /href="\/about"/);
  assert.doesNotMatch(terms, /実装確認用|公開前に運営者/);
  assert.match(footer, /href="\/terms">利用にあたって<\/a>/);
});
