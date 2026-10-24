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

import { searchArticles, type SearchableArticle } from './article-search';
const searchItem = (slug: string, overrides: Partial<SearchableArticle> = {}): SearchableArticle => ({slug, title: slug, text: slug, series: '', topics: [], tags: [], features: [], intent: 'try', publishedAt: '2026-10-01', updatedAt: '2026-10-01', ...overrides});
describe('combined discovery search', () => {
  it('matches all normalized words across title and author and prioritizes title', () => {
    const title = searchItem('title', {title:'Python を使う', text:'Python を使う Alice'});
    const body = searchItem('body', {text:'紹介 python Alice', publishedAt:'2026-10-02'});
    const other = searchItem('other', {text:'Python Bob'});
    expect(searchArticles([body, other, title], new URLSearchParams('keyword=Ｐｙｔｈｏｎ+ＡＬＩＣＥ'))).toEqual([title,body]);
  });
  it('combines format, intent and metadata filters without mutating source', () => {
    const match = searchItem('match', {features:['code','math'],intent:'build',tags:['Python'],topics:['data-models']});
    const partial = searchItem('partial', {features:['code'],intent:'build',tags:['Python'],topics:['data-models']});
    expect(searchArticles([partial,match],new URLSearchParams('feature=code&feature=math&intent=build&tag=Python&topic=data-models'))).toEqual([match]);
    expect(searchArticles([match],new URLSearchParams('feature=unknown'))).toEqual([]);
  });
  it('supports explicit date sorting independently of relevance', () => {
    const older = searchItem('older',{title:'Python',text:'Python',updatedAt:'2026-10-03'});
    const newer = searchItem('newer',{text:'Python',publishedAt:'2026-10-02'});
    expect(searchArticles([older,newer],new URLSearchParams('keyword=python&sort=published'))).toEqual([newer,older]);
    expect(searchArticles([older,newer],new URLSearchParams('sort=updated'))).toEqual([older,newer]);
  });
});
