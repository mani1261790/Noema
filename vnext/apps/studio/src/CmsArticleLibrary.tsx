import { useDeferredValue, useMemo, useRef } from "react";
import {
  cmsVisibilityLabels,
  type CmsArticleSummary,
  type CmsRole
} from "@noema/cms";
import {
  cmsArticleFilterOptions,
  filterCmsArticles,
  type CmsArticleFilter
} from "./article-library";
import { getCmsJourneyStatus } from "./CmsPublicationJourney";

export type CmsLibraryConnection =
  | { kind: "checking" }
  | { kind: "ready"; email: string; role: CmsRole }
  | { kind: "unavailable"; message: string };

interface CmsArticleLibraryProps {
  articles: CmsArticleSummary[];
  busy: boolean;
  canCreate: boolean;
  canOpenArticles: boolean;
  connection: CmsLibraryConnection;
  filter: CmsArticleFilter;
  hasRecoveryDraft: boolean;
  hasWorkingEditor: boolean;
  recoveryNeedsArticleAssociation: boolean;
  openingArticleId: string | null;
  recoveryCharacterCount: number;
  recoverySaveStatus: string;
  recoveryTitle: string;
  workingArticleActionLabel: string;
  workingArticleStatus: { text: string; tone: "error" | "info" } | null;
  onContinueRecovery: () => void;
  onContinueRecoveryAsNew: () => void;
  onCreate: () => void;
  onDownloadRecovery: () => void;
  onEdit: (articleId: string) => void;
  onFilterChange: (filter: CmsArticleFilter) => void;
  onQueryChange: (query: string) => void;
  onReturnToEditor: () => void;
  onRetry: () => void;
  query: string;
}

const articleDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short"
});

function formatArticleDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : articleDateFormatter.format(date);
}

export function getCmsArticleActionLabel(
  article: CmsArticleSummary,
  role: CmsRole
): string {
  if (article.reviewStatus === "changes_requested") {
    return role === "reviewer" ? "修正内容を確認" : "修正する";
  }
  if (article.reviewStatus === "in_review") {
    return role === "editor" ? "レビュー状況を確認" : "レビューする";
  }
  if (article.reviewStatus === "approved" && article.publicationStatus === "unpublished") {
    return role === "admin" ? "公開を確認" : "承認内容を確認";
  }
  if (role === "reviewer") return "内容を確認";
  return "編集する";
}

function CmsArticleListItem({
  article,
  busy,
  canOpen,
  opening,
  recoveryNeedsArticleAssociation,
  actionLabel,
  onEdit
}: {
  actionLabel: string;
  article: CmsArticleSummary;
  busy: boolean;
  canOpen: boolean;
  opening: boolean;
  recoveryNeedsArticleAssociation: boolean;
  onEdit: (articleId: string) => void;
}) {
  const title = article.title.trim() || "無題の記事";
  const actionAriaLabel = actionLabel.includes("確認")
    ? `「${title}」の${actionLabel}`
    : `「${title}」を${actionLabel}`;
  const status = getCmsJourneyStatus(article.reviewStatus, article.publicationStatus);
  return (
    <li className="studio-library-item">
      <div className="studio-library-item__main">
        <div className="studio-library-item__title">
          <span
            aria-label={status.detail ? `${status.label}。${status.detail}` : status.label}
            className="studio-library-item__status"
          >
            {status.label}
          </span>
          <h3>{title}</h3>
        </div>
        <p className="studio-library-item__meta">
          <time dateTime={article.updatedAt}>更新 {formatArticleDate(article.updatedAt)}</time>
          {article.visibility !== "public" ? <span>{cmsVisibilityLabels[article.visibility]}</span> : null}
        </p>
      </div>
      <button
        aria-label={opening
          ? `「${title}」を開いています`
          : recoveryNeedsArticleAssociation
            ? `復旧原稿を「${title}」に引き継ぐ`
            : actionAriaLabel}
        className="dads-button studio-library-item__edit"
        data-size="md"
        data-type="outline"
        disabled={busy || !canOpen}
        onClick={() => onEdit(article.id)}
        type="button"
      >
        {opening ? "開いています…" : recoveryNeedsArticleAssociation ? "この内容を引き継ぐ" : actionLabel}
      </button>
    </li>
  );
}

function RecoveryDraftCard({
  characterCount,
  needsArticleAssociation,
  saveStatus,
  title,
  onContinue,
  onContinueAsNew,
  onDownload
}: {
  characterCount: number;
  needsArticleAssociation: boolean;
  saveStatus: string;
  title: string;
  onContinue: () => void;
  onContinueAsNew: () => void;
  onDownload: () => void;
}) {
  return (
    <section aria-labelledby="studio-recovery-heading" className="studio-library-recovery">
      <div>
        <p className="studio-library-recovery__eyebrow">
          {needsArticleAssociation ? "旧Studioからの復旧原稿" : "このブラウザの復旧原稿"}
        </p>
        <h2 id="studio-recovery-heading">{title.trim() || "無題の復旧原稿"}</h2>
        <p>{needsArticleAssociation
          ? "既存記事を編集中だった可能性があります。元の記事なら下の一覧から「この内容を引き継ぐ」を選び、新しい原稿なら「新しい記事として続ける」を選んでください。"
          : "CMSにはまだ保存されていません。共有やレビューの前に、編集画面からCMSへ保存してください。"}</p>
        <p className="studio-library-recovery__meta">本文 {characterCount.toLocaleString("ja-JP")}文字 · {saveStatus}</p>
      </div>
      <div className="studio-library-recovery__actions">
        <button className="dads-button" data-size="md" data-type="solid-fill" onClick={onContinue} type="button">
          {needsArticleAssociation ? "内容を確認する" : "編集を続ける"}
        </button>
        {needsArticleAssociation ? (
          <button className="dads-button" data-size="md" data-type="outline" onClick={onContinueAsNew} type="button">
            新しい記事として続ける
          </button>
        ) : null}
        <button className="dads-button" data-size="md" data-type="outline" onClick={onDownload} type="button">
          Markdownを書き出す
        </button>
      </div>
    </section>
  );
}

export function CmsArticleLibrary({
  articles,
  busy,
  canCreate,
  canOpenArticles,
  connection,
  filter,
  hasRecoveryDraft,
  hasWorkingEditor,
  recoveryNeedsArticleAssociation,
  openingArticleId,
  recoveryCharacterCount,
  recoverySaveStatus,
  recoveryTitle,
  workingArticleActionLabel,
  workingArticleStatus,
  onContinueRecovery,
  onContinueRecoveryAsNew,
  onCreate,
  onDownloadRecovery,
  onEdit,
  onFilterChange,
  onQueryChange,
  onReturnToEditor,
  onRetry,
  query
}: CmsArticleLibraryProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const visibleArticles = useMemo(
    () => filterCmsArticles(articles, deferredQuery, filter),
    [articles, deferredQuery, filter]
  );
  const filterOptions = useMemo(
    () => cmsArticleFilterOptions.map((option) => ({
      ...option,
      count: filterCmsArticles(articles, "", option.value).length
    })),
    [articles]
  );
  const hasConditions = query.trim().length > 0 || filter !== "all";
  const clearConditions = () => {
    onQueryChange("");
    onFilterChange("all");
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  return (
    <main
      aria-busy={connection.kind === "checking" || busy}
      aria-labelledby="studio-article-library-heading"
      className="studio-library"
    >
      <div className="studio-library__inner">
        {workingArticleStatus ? (
          <section
            aria-label="編集中の記事の状態"
            className={`studio-library-working-state is-${workingArticleStatus.tone}`}
          >
            <p
              className="studio-library-save-state"
              role={workingArticleStatus.tone === "error" ? "alert" : "status"}
            >
              {workingArticleStatus.text}
            </p>
            {hasWorkingEditor ? (
              <button
                className="dads-button"
                data-size="md"
                data-type="solid-fill"
                onClick={onReturnToEditor}
                type="button"
              >
                {workingArticleActionLabel}
              </button>
            ) : null}
          </section>
        ) : null}

        <header className="studio-library__heading">
          <h1 id="studio-article-library-heading" tabIndex={-1}>記事</h1>
          {canCreate ? (
            <button
              className="dads-button studio-library__create"
              data-size="md"
              data-type="solid-fill"
              disabled={busy}
              onClick={onCreate}
              type="button"
            >
              新しい記事
            </button>
          ) : null}
        </header>

        {hasRecoveryDraft ? (
          <RecoveryDraftCard
            characterCount={recoveryCharacterCount}
            needsArticleAssociation={recoveryNeedsArticleAssociation}
            onContinue={onContinueRecovery}
            onContinueAsNew={onContinueRecoveryAsNew}
            onDownload={onDownloadRecovery}
            saveStatus={recoverySaveStatus}
            title={recoveryTitle}
          />
        ) : null}

        {connection.kind === "checking" ? (
          <section className="studio-library-state" role="status">
            <h2>記事を読み込んでいます</h2>
            <p>CMSの権限と記事一覧を確認しています。</p>
          </section>
        ) : null}

        {connection.kind === "unavailable" ? (
          <section className="studio-library-state is-error" role="alert">
            <h2>CMSに接続できません</h2>
            <p>{connection.message}</p>
            <p>{hasWorkingEditor
              ? "編集中の記事と復旧コピーは、このブラウザに保持しています。編集画面へ戻って内容を確認できます。"
              : "復旧原稿がある場合は、上の復旧原稿から内容の確認やMarkdown書き出しを続けられます。"}</p>
            <div className="studio-library-state__actions">
              {hasWorkingEditor ? (
                <button className="dads-button" data-size="md" data-type="solid-fill" onClick={onReturnToEditor} type="button">
                  編集画面に戻る
                </button>
              ) : null}
              <button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">
                もう一度確認
              </button>
            </div>
          </section>
        ) : null}

        {connection.kind === "ready" ? (
          <section aria-label="記事一覧" className="studio-library__saved">
            <div aria-label="CMSの記事を検索・絞り込み" className="studio-library-controls" role="search">
              <label className="sr-only" htmlFor="studio-article-search">記事を検索</label>
              <input
                aria-label="記事を検索"
                id="studio-article-search"
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="タイトル、URL、更新者で検索"
                ref={searchInputRef}
                type="search"
                value={query}
              />
              <label className="sr-only" htmlFor="studio-article-filter">状態で絞り込む</label>
              <select
                aria-label="状態で絞り込む"
                id="studio-article-filter"
                onChange={(event) => onFilterChange(event.target.value as CmsArticleFilter)}
                value={filter}
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}（{option.count}）</option>
                ))}
              </select>
              <p aria-atomic="true" aria-live="polite" className="studio-library__count">
                {hasConditions ? `${visibleArticles.length}件（全${articles.length}件）` : `${articles.length}件`}
              </p>
              {hasConditions ? (
                <button className="studio-library__clear" onClick={clearConditions} type="button">
                  検索条件をクリア
                </button>
              ) : null}
            </div>

            {articles.length === 0 ? (
              <div className="studio-library-empty">
                <h3>CMSの記事はまだありません</h3>
                <p>{canCreate ? "最初の記事を作ると、ここからいつでも開けます。" : "表示できる記事はまだありません。"}</p>
                {canCreate ? (
                  <button className="dads-button" data-size="md" data-type="solid-fill" onClick={onCreate} type="button">
                    最初の記事を書く
                  </button>
                ) : null}
              </div>
            ) : visibleArticles.length === 0 ? (
              <div className="studio-library-empty">
                <h3>条件に一致する記事はありません</h3>
                <p>検索語や「表示する記事」を変えると、別の記事を探せます。</p>
              </div>
            ) : (
              <ul className="studio-library-list">
                {visibleArticles.map((article) => (
                  <CmsArticleListItem
                    actionLabel={getCmsArticleActionLabel(article, connection.role)}
                    article={article}
                    busy={busy}
                    canOpen={canOpenArticles}
                    key={article.id}
                    onEdit={onEdit}
                    opening={openingArticleId === article.id}
                    recoveryNeedsArticleAssociation={recoveryNeedsArticleAssociation}
                  />
                ))}
              </ul>
            )}
          </section>
        ) : null}

      </div>
    </main>
  );
}
