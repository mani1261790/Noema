import assert from "node:assert/strict";
import test from "node:test";
import { suggestArticleMetadata } from "../src/article-autofill.ts";

test("infers editorial metadata from Japanese Markdown", () => {
  const suggestion = suggestArticleMetadata({
    body: "## CloudflareでRAGを実装する\n\nこの記事では、TypeScriptとAPIを使って検索拡張生成を実装する手順を説明します。",
    currentTitle: "",
    updatedAt: "2026-08-11"
  });

  assert.equal(suggestion.title, "CloudflareでRAGを実装する");
  assert.equal(suggestion.approach, "development");
  assert.equal(suggestion.slug, "cloudflare-rag");
  assert.ok(suggestion.topics.includes("development-environment"));
  assert.ok(suggestion.topics.includes("research-organization"));
  assert.deepEqual(suggestion.tags, ["RAG", "Cloudflare", "TypeScript", "API"]);
  assert.match(suggestion.description, /検索拡張生成/);
});

test("creates a stable safe slug for a Japanese-only title", () => {
  const input = {
    body: "## はじめての生成AI\n\n生成AIを初めて試す人に向けて、基本的な使い方を紹介します。",
    currentTitle: "",
    updatedAt: "2026-08-11"
  };
  const first = suggestArticleMetadata(input);
  const second = suggestArticleMetadata(input);

  assert.match(first.slug, /^article-20260811-[a-z0-9]{6}$/);
  assert.equal(first.slug, second.slug);
  assert.equal(first.approach, "experience");
  assert.ok(first.topics.includes("generation-creation"));
});

test("keeps an explicitly supplied title", () => {
  const suggestion = suggestArticleMetadata({
    body: "## 本文側の見出し\n\n十分な長さの本文段落がここに入ります。内容を整理して説明します。",
    currentTitle: "編集者が決めたタイトル",
    updatedAt: "2026-08-11"
  });

  assert.equal(suggestion.title, "編集者が決めたタイトル");
});
