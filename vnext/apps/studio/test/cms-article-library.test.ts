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
});
