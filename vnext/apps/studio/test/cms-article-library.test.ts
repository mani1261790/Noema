import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsArticleSummary, CmsSeries } from "@noema/cms";
import { CmsArticleLibrary } from "../src/CmsArticleLibrary";

const article: CmsArticleSummary = {
  id: "article-1",
  lockVersion: 3,
  publicationStatus: "published",
  revisionNumber: 3,
  reviewStatus: "draft",
  slug: "workers-ai-guide",
  title: "Workers AI ガイド",
  updatedAt: "2026-07-18T08:00:00.000Z",
  updatedByEmail: "editor@example.com",
  visibility: "public"
};

const series: CmsSeries = {
  articleIds: ["article-intro", article.id],
  articles: [],
  createdAt: "2026-07-17T08:00:00.000Z",
  description: "順番に学ぶシリーズです。",
  id: "series-1",
  lockVersion: 2,
  revisionNumber: 2,
  slug: "cloudflare-guide",
  title: "Cloudflare入門",
  updatedAt: "2026-07-18T08:00:00.000Z",
  updatedByEmail: "editor@example.com"
};

const baseProps: ComponentProps<typeof CmsArticleLibrary> = {
  articles: [],
  busy: false,
  canCreate: true,
  canOpenArticles: true,
  connection: { email: "admin@example.com", kind: "ready", role: "admin" },
  filter: "all",
  hasRecoveryDraft: false,
  hasWorkingEditor: false,
  onContinueRecovery: () => undefined,
  onContinueRecoveryAsNew: () => undefined,
  onCreate: () => undefined,
  onDownloadRecovery: () => undefined,
  onEdit: () => undefined,
  onFilterChange: () => undefined,
  onQueryChange: () => undefined,
  onRetry: () => undefined,
  onReturnToEditor: () => undefined,
  openingArticleId: null,
  query: "",
  recoveryCharacterCount: 0,
  recoveryNeedsArticleAssociation: false,
  recoverySaveStatus: "ブラウザに保存済み",
  recoveryTitle: "",
  series: [],
  workingArticleActionLabel: "編集画面に戻る",
  workingArticleStatus: null
};

function renderLibrary(overrides: Partial<ComponentProps<typeof CmsArticleLibrary>> = {}): string {
  return renderToStaticMarkup(createElement(CmsArticleLibrary, { ...baseProps, ...overrides }));
}

describe("CmsArticleLibrary", () => {
  it("keeps search and publication filters visible when the CMS has no articles", () => {
    const html = renderLibrary();

    expect(html).toContain('role="search"');
    expect(html).toContain('id="studio-article-search"');
    expect(html).toContain('id="studio-article-filter"');
    expect(html.match(/<option/g)).toHaveLength(6);
    expect(html).toContain("公開中（0）");
    expect(html).toContain("レビュー対応（0）");
    expect(html).toContain("0件");
    expect(html).toContain("CMSの記事はまだありません");
    expect(html).not.toContain("studio-public-link");
    expect(html).not.toContain("<a ");
  });

  it("shows one clear action and an accessible result count when no article matches", () => {
    const html = renderLibrary({ articles: [article], query: "該当しない検索語" });

    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("0件（全1件）");
    expect(html).toContain("条件に一致する記事はありません");
    expect(html.match(/条件をリセット/g)).toHaveLength(1);
  });

  it("hides article search until the CMS connection is ready", () => {
    const html = renderLibrary({ connection: { kind: "checking" } });

    expect(html).toContain("記事を読み込んでいます");
    expect(html).not.toContain('id="studio-article-search"');
  });

  it("integrates review counts into the status filter without a separate queue", () => {
    const reviewArticle = { ...article, publicationStatus: "unpublished" as const, reviewStatus: "in_review" as const };
    const html = renderLibrary({ articles: [reviewArticle], filter: "review" });

    expect(html).not.toContain("対応待ち");
    expect(html).toContain("レビュー・承認（1）");
    expect(html).toContain("レビューする");
  });

  it("keeps review and edit actions distinct even in the unfiltered article list", () => {
    const reviewArticle = {
      ...article,
      id: "article-review",
      publicationStatus: "unpublished" as const,
      reviewStatus: "in_review" as const,
      title: "レビュー対象"
    };
    const html = renderLibrary({ articles: [article, reviewArticle] });

    expect(html).toContain('aria-label="「レビュー対象」をレビューする"');
    expect(html).toContain(">レビューする</button>");
    expect(html).toContain('aria-label="「Workers AI ガイド」を編集する"');
    expect(html).toContain(">編集する</button>");
  });

  it("labels approved published articles as publication management", () => {
    const approvedArticle = {
      ...article,
      reviewStatus: "approved" as const
    };
    const html = renderLibrary({ articles: [approvedArticle] });

    expect(html).toContain('aria-label="「Workers AI ガイド」の公開を管理"');
    expect(html).toContain(">公開を管理</button>");
    expect(html).not.toContain(">編集する</button>");
  });

  it("shows review progress instead of an edit action to editors", () => {
    const reviewArticle = {
      ...article,
      publicationStatus: "unpublished" as const,
      reviewStatus: "in_review" as const,
      title: "レビュー対象"
    };
    const html = renderLibrary({
      articles: [reviewArticle],
      connection: { email: "editor@example.com", kind: "ready", role: "editor" }
    });

    expect(html).toContain("レビュー状況を確認");
    expect(html).not.toContain(">編集する</button>");
  });

  it("keeps review responses separate from ordinary drafts", () => {
    const correctionArticle = {
      ...article,
      publicationStatus: "unpublished" as const,
      reviewStatus: "changes_requested" as const
    };
    const html = renderLibrary({
      articles: [correctionArticle],
      connection: { email: "editor@example.com", kind: "ready", role: "editor" },
      filter: "changes_requested"
    });

    expect(html).toContain("レビュー対応（1）");
    expect(html).toContain("レビュー対応を開く");
    expect(html).not.toContain("対応待ち");
  });

  it("keeps each article row to one status, title, date, and action", () => {
    const html = renderLibrary({ articles: [article] });

    expect(html).toContain("公開中・新しい版は下書き");
    expect(html).toContain("現在の公開版はそのまま");
    expect(html).toContain("studio-library-item__status");
    expect(html).toMatch(/更新 2026\/07\/18 \d{1,2}:00/);
    expect(html).not.toContain("/workers-ai-guide");
    expect(html).not.toContain("revision 3");
    expect(html).not.toContain("editor@example.com");
    expect(html).not.toContain("1 / 4");
  });

  it("shows series membership and position in the article list", () => {
    const html = renderLibrary({ articles: [article], series: [series] });

    expect(html).toContain("Cloudflare入門");
    expect(html).toContain("第2回／全2記事");
    expect(html).toContain("studio-library-item__series");
  });

  it("finds an article by its series title", () => {
    const html = renderLibrary({ articles: [article], query: "Cloudflare入門", series: [series] });

    expect(html).toContain("Workers AI ガイド");
    expect(html).not.toContain("条件に一致する記事はありません");
  });

  it("keeps article editing and an explicit recovery action available for a held recovery copy", () => {
    const html = renderLibrary({
      articles: [article],
      hasWorkingEditor: true,
      workingArticleActionLabel: "競合を確認・解消",
      workingArticleStatus: {
        text: "CMS側でも更新されています。競合を確認し、必要な内容を選んで解消してください。",
        tone: "info"
      }
    });

    expect(html).toContain("競合を確認・解消");
    expect(html).toContain("競合を確認し、必要な内容を選んで解消してください。");
    expect(html).toContain('aria-label="編集中の記事の状態"');
    expect(html.indexOf("競合を確認・解消")).toBeLessThan(html.indexOf('<h1 id="studio-article-library-heading"'));
    expect(html).toContain(">編集する</button>");
    expect(html).not.toMatch(/studio-library-item__edit[^>]*disabled/);
  });

  it("hides creation and login details from the reviewer home", () => {
    const html = renderLibrary({
      articles: [article],
      canCreate: false,
      connection: { email: "reviewer@example.com", kind: "ready", role: "reviewer" }
    });

    expect(html).not.toContain("新しい記事");
    expect(html).not.toContain("reviewer@example.com");
    expect(html).not.toContain("ログイン中");
    expect(html).toContain("内容を確認");
    expect(html).not.toContain(">編集する</button>");
  });
});
