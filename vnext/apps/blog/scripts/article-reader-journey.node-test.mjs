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

test("opens a resizable split chat panel only from a text-selection chip", async () => {
  const [assistant, form, styles] = await Promise.all([
    readFile(articleAssistantUrl, "utf8"),
    readFile(assistantFormUrl, "utf8"),
    readFile(blogStylesUrl, "utf8"),
  ]);

  assert.doesNotMatch(assistant, /data-open-assistant|assistant-trigger/);
  assert.match(assistant, /data-assistant-selection-chip/);
  assert.match(assistant, /data-assistant-resize-handle/);
  assert.match(assistant, /role="separator"/);
  assert.match(assistant, /M7\.9 20A9 9 0 1 0 4 16\.1L2 22Z/);
  assert.match(styles, /\.assistant-panel \{[\s\S]*?position: fixed;[\s\S]*?inset-block: calc\(5rem \+ 1px\) 0;[\s\S]*?box-shadow: none;/);
  assert.match(styles, /\.article-page\[data-assistant-open="true"\] \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) var\(--assistant-panel-width\);/);
  assert.match(styles, /\.assistant-panel__resize-handle \{[\s\S]*?cursor: ew-resize;[\s\S]*?touch-action: none;/);
  assert.match(assistant, /resolveAssistantPanelResize\(window\.innerWidth - event\.clientX/);
  assert.match(assistant, /result\.shouldClose\)[\s\S]*?closePanel\(\)/);
  assert.match(styles, /\.assistant-selection \{[\s\S]*?border: 0;/);
  assert.doesNotMatch(styles, /\.assistant-selection \{[\s\S]*?border-inline-start/);
  assert.match(form, /data-question data-mode="api-key" rows="1"/);
  assert.match(form, /placeholder="最初にOpenAI APIキーを入力してください"/);
  assert.doesNotMatch(form, /data-api-key|assistant-field--key|assistant-suggestions|data-question-suggestion/);
  assert.doesNotMatch(assistant, /data-api-key|data-toggle-key|data-question-suggestion/);
  assert.match(assistant, /if \(!apiKey\)[\s\S]*?apiKey = input;[\s\S]*?syncComposerMode\(\)/);
  assert.match(assistant, /response\.status === 401[\s\S]*?apiKey = "";[\s\S]*?syncComposerMode\(\)/);
  assert.match(form, /class="assistant-send" type="submit" aria-label="APIキーを設定"/);
  assert.match(styles, /\.assistant-composer \{[\s\S]*?border-radius: 999px;/);
  assert.doesNotMatch(styles, /\.assistant-composer:focus-within/);
  assert.match(styles, /textarea\[data-mode="api-key"\][\s\S]*?-webkit-text-security: disc;/);
  assert.match(styles, /textarea\[data-multiline="true"\][\s\S]*?border-radius: 1\.25rem;/);
  assert.match(assistant, /assistant-message--user/);
  assert.match(assistant, /assistant-message--assistant/);
});
