import { describe, expect, it } from "vitest";

import { buildArticleSearchText, normalizeArticleSearchText } from "./article-search";

describe("normalizeArticleSearchText", () => {
  it("normalizes width, case, and repeated whitespace", () => {
    expect(normalizeArticleSearchText("  Ｃｏｄｅｘ   API\n入門  ")).toBe("codex api 入門");
  });
});

describe("buildArticleSearchText", () => {
  it("indexes the reader-facing series and topic names alongside article fields", () => {
    const searchText = buildArticleSearchText({
      description: "AIが何をしているかを説明します。",
      excerpt: "初めての人向けの記事です。",
      seriesTitle: "はじめてのAI",
      tags: ["ChatGPT", "Codex"],
      title: "コーディングエージェントとは",
      topicLabels: ["対話AI"],
    });

    expect(searchText).toContain("対話ai");
    expect(searchText).toContain("はじめてのai");
    expect(searchText).toContain("chatgpt codex");
  });

  it("omits an absent series without leaving unstable whitespace", () => {
    expect(buildArticleSearchText({
      description: "概要",
      excerpt: "抜粋",
      tags: [],
      title: "単独記事",
      topicLabels: ["開発環境"],
    })).toBe("単独記事 概要 抜粋 開発環境");
  });
});

describe("reader author search", () => {
  it("finds every credited author and the public editor name after normalization", () => {
    const searchText = buildArticleSearchText({
      title: "検索の検証",
      authors: ["山田 太郎", "ＡＬＩＣＥ"],
      editorDisplayName: "公開プロフィール名",
      description: "概要",
      excerpt: "抜粋",
      tags: [],
      topicLabels: [],
    });
    for (const query of ["山田", "alice", "Ａｌｉｃｅ", "公開プロフィール名"]) {
      expect(searchText).toContain(normalizeArticleSearchText(query));
    }
  });
});
