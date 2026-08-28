import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const articlePageUrl = new URL("../src/pages/articles/[...slug].astro", import.meta.url);
const articlePreviewUrl = new URL("../src/pages/preview/article.astro", import.meta.url);
const relatedArticlesUrl = new URL("../src/components/RelatedArticles.astro", import.meta.url);

test("offers the next reading choice before share and update actions", async () => {
  const [articlePage, articlePreview, relatedArticles] = await Promise.all([
    readFile(articlePageUrl, "utf8"),
    readFile(articlePreviewUrl, "utf8"),
    readFile(relatedArticlesUrl, "utf8"),
  ]);

  for (const source of [articlePage, articlePreview]) {
    const relatedPosition = source.indexOf("<RelatedArticles");
    const sharePosition = source.indexOf("<ShareArticle");
    const updatesPosition = source.indexOf("<ArticleUpdatesCta");

    assert.ok(relatedPosition >= 0);
    assert.ok(relatedPosition < sharePosition);
    assert.ok(relatedPosition < updatesPosition);
  }
  assert.match(relatedArticles, />次に読む</);
  assert.match(relatedArticles, /いま読んだ内容につながる記事です。/);
  assert.match(relatedArticles, /data-analytics-navigation="related"/);
});
