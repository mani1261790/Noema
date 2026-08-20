import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsArticleSummary } from "@noema/cms";
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
    expect(html).toContain('aria-describedby="studio-article-search-description"');
    expect(html.match(/aria-pressed=/g)).toHaveLength(5);
    expect(html).toContain("公開中");
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
    expect(html.match(/検索条件をクリア/g)).toHaveLength(1);
  });

  it("hides article search until the CMS connection is ready", () => {
    const html = renderLibrary({ connection: { kind: "checking" } });

    expect(html).toContain("記事を読み込んでいます");
    expect(html).not.toContain('id="studio-article-search"');
  });

  it("shows an admin queue and changes the article action for a selected task", () => {
    const reviewArticle = { ...article, publicationStatus: "unpublished" as const, reviewStatus: "in_review" as const };
    const html = renderLibrary({ articles: [reviewArticle], filter: "in_review" });

    expect(html).toContain('id="studio-editorial-queue-heading"');
    expect(html).toContain("レビューする記事");
    expect(html).not.toContain("公開する記事");
    expect(html).toContain("レビューする");
    expect(html).toContain("だけを表示しています");
  });

  it("shows only the correction queue to editors", () => {
    const correctionArticle = {
      ...article,
      publicationStatus: "unpublished" as const,
      reviewStatus: "changes_requested" as const
    };
    const html = renderLibrary({
      articles: [correctionArticle],
      connection: { email: "editor@example.com", kind: "ready", role: "editor" }
    });

    expect(html).toContain("修正する記事");
    expect(html).not.toContain("公開する記事");
    expect(html).not.toContain("レビューする記事");
  });

  it("keeps each article row to one status, title, date, slug, and action", () => {
    const html = renderLibrary({ articles: [article] });

    expect(html).toContain("公開中・新しい版は下書き");
    expect(html).toContain("現在の公開版はそのまま");
    expect(html).toContain("studio-library-item__status");
    expect(html).toMatch(/更新 2026\/07\/18 \d{1,2}:00/);
    expect(html).toContain("/workers-ai-guide");
    expect(html).not.toContain("revision 3");
    expect(html).not.toContain("editor@example.com");
    expect(html).not.toContain("1 / 4");
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
    expect(html).toContain(">編集する</button>");
    expect(html).not.toMatch(/studio-library-item__edit[^>]*disabled/);
  });
});
