import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const articlePageUrl = new URL("../src/pages/articles/[...slug].astro", import.meta.url);
const articlePreviewUrl = new URL("../src/pages/preview/article.astro", import.meta.url);
const relatedArticlesUrl = new URL("../src/components/RelatedArticles.astro", import.meta.url);
const articleAssistantUrl = new URL("../src/components/ArticleAssistant.astro", import.meta.url);
const assistantFormUrl = new URL("../src/components/AssistantForm.astro", import.meta.url);
const blogStylesUrl = new URL("../src/styles/blog.css", import.meta.url);

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

test("opens a fixed chat panel only from a text-selection chip", async () => {
  const [assistant, form, styles] = await Promise.all([
    readFile(articleAssistantUrl, "utf8"),
    readFile(assistantFormUrl, "utf8"),
    readFile(blogStylesUrl, "utf8"),
  ]);

  assert.doesNotMatch(assistant, /data-open-assistant|assistant-trigger/);
  assert.match(assistant, /data-assistant-selection-chip/);
  assert.match(assistant, /M7\.9 20A9 9 0 1 0 4 16\.1L2 22Z/);
  assert.match(styles, /\.assistant-panel \{[\s\S]*?position: fixed;[\s\S]*?inset-block: calc\(5rem \+ 1px\) 0;[\s\S]*?box-shadow: none;/);
  assert.match(styles, /\.assistant-selection \{[\s\S]*?border: 0;/);
  assert.doesNotMatch(styles, /\.assistant-selection \{[\s\S]*?border-inline-start/);
  assert.match(form, /data-question rows="1"/);
  assert.match(form, /class="assistant-send" type="submit" aria-label="質問を送信"/);
  assert.match(styles, /\.assistant-composer \{[\s\S]*?border-radius: 999px;/);
  assert.match(styles, /textarea\[data-multiline="true"\][\s\S]*?border-radius: 1\.25rem;/);
  assert.match(assistant, /assistant-message--user/);
  assert.match(assistant, /assistant-message--assistant/);
});
