import { useDeferredValue, useMemo, useRef } from "react";
import {
  cmsRoleLabels,
  cmsVisibilityLabels,
  type CmsArticleSummary,
  type CmsRole
} from "@noema/cms";
import {
  cmsArticleFilterOptions,
  filterCmsArticles,
  getCmsEditorialQueue,
  type CmsArticleFilter
} from "./article-library";
import { CmsPublicationJourney } from "./CmsPublicationJourney";

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
  const actionAriaLabel = actionLabel === "公開を確認"
    ? `「${title}」の公開を確認`
    : `「${title}」を${actionLabel}`;
  return (
    <li className="studio-library-item">
      <div className="studio-library-item__main">
        <CmsPublicationJourney
          compact
          publicationStatus={article.publicationStatus}
          reviewStatus={article.reviewStatus}
        />
        <h3>{title}</h3>
        <p className="studio-library-item__slug">
          <span>スラッグ</span> {article.slug || "未設定"}
          <span aria-hidden="true"> · </span>
          revision {article.revisionNumber}
        </p>
        <p className="studio-library-item__updated">
          <time dateTime={article.updatedAt}>{formatArticleDate(article.updatedAt)}</time>
          <span>{article.updatedByEmail}</span>
          <span>{cmsVisibilityLabels[article.visibility]}</span>
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
  const editorialQueue = useMemo(
    () => connection.kind === "ready" ? getCmsEditorialQueue(articles, connection.role) : [],
    [articles, connection]
  );
  const queueCount = editorialQueue.reduce((total, item) => total + item.count, 0);
  const queueFilters = new Set(editorialQueue.map((item) => item.filter));
  const hasConditions = query.trim().length > 0 || filter !== "all";
  const articleActionLabel = filter === "changes_requested"
    ? "修正する"
    : filter === "in_review"
      ? "レビューする"
      : filter === "ready_to_publish"
        ? "公開を確認"
        : "編集する";
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
        <header className="studio-library__heading">
          <div>
            <p className="studio-library__eyebrow">Noema Studio</p>
            <h1 id="studio-article-library-heading" tabIndex={-1}>記事を管理</h1>
            <p>記事を検索して編集するか、新しい記事を書き始めます。</p>
          </div>
          <button
            className="dads-button studio-library__create"
            data-size="lg"
            data-type="solid-fill"
            disabled={!canCreate || busy}
            onClick={onCreate}
            type="button"
          >
            新しい記事を書く
          </button>
        </header>

        {workingArticleStatus ? (
          <p
            className={`studio-library-save-state is-${workingArticleStatus.tone}`}
            role={workingArticleStatus.tone === "error" ? "alert" : "status"}
          >
            {workingArticleStatus.text}
          </p>
        ) : null}

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
          <section aria-labelledby="studio-editorial-queue-heading" className="studio-editorial-queue">
            <div className="studio-editorial-queue__heading">
              <div>
                <p className="studio-library__eyebrow">次にやること</p>
                <h2 id="studio-editorial-queue-heading">対応する記事</h2>
              </div>
              <strong>{queueCount === 0 ? "対応待ちなし" : `${queueCount}件`}</strong>
            </div>
            <div className="studio-editorial-queue__items">
              {editorialQueue.map((item) => (
                <button
                  aria-pressed={filter === item.filter}
                  className="studio-editorial-queue__item"
                  disabled={item.count === 0}
                  key={item.filter}
                  onClick={() => {
                    onQueryChange("");
                    onFilterChange(item.filter);
                  }}
                  type="button"
                >
                  <span><strong>{item.label}</strong><b>{item.count}</b></span>
                  <small>{item.description}</small>
                </button>
              ))}
            </div>
            <p className="studio-editorial-queue__flow">
              公開までの4段階 <span aria-hidden="true">下書き → レビュー中 → 承認済み → 公開</span>
            </p>
            {queueCount === 0 ? <p className="studio-editorial-queue__empty">いま対応が必要な記事はありません。新しい記事を書くか、下の一覧から作業を続けられます。</p> : null}
          </section>
        ) : null}

        {connection.kind === "ready" ? (
          <section aria-labelledby="studio-saved-articles-heading" className="studio-library__saved">
            <div className="studio-library__saved-heading">
              <div>
                <h2 id="studio-saved-articles-heading">記事を探す</h2>
                <p id="studio-article-search-description">下書き、レビュー中、公開中、保管済みの記事をまとめて検索できます。</p>
              </div>
              <p aria-atomic="true" aria-live="polite" className="studio-library__count">
                {hasConditions ? `${visibleArticles.length}件（全${articles.length}件）` : `${articles.length}件`}
              </p>
            </div>

            <div aria-label="CMSの記事を検索・絞り込み" className="studio-library-controls" role="search">
              <label htmlFor="studio-article-search">キーワードで検索</label>
              <input
                aria-describedby="studio-article-search-description"
                id="studio-article-search"
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="記事タイトル、スラッグ、更新者"
                ref={searchInputRef}
                type="search"
                value={query}
              />
              <fieldset>
                <legend>表示する記事</legend>
                <div className="studio-library-filters">
                  {cmsArticleFilterOptions.map((option) => (
                    <button
                      aria-pressed={filter === option.value}
                      key={option.value}
                      onClick={() => onFilterChange(option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              {queueFilters.has(filter) ? (
                <p className="studio-library-controls__queue-filter" role="status">
                  「{editorialQueue.find((item) => item.filter === filter)?.label}」だけを表示しています。
                </p>
              ) : null}
              {hasConditions ? (
                <button className="studio-library__clear" onClick={clearConditions} type="button">
                  検索条件をクリア
                </button>
              ) : null}
            </div>

            {articles.length === 0 ? (
              <div className="studio-library-empty">
                <h3>CMSの記事はまだありません</h3>
                <p>最初の記事を作ると、保存後はここからいつでも開いて再編集できます。</p>
                <p>公開サイトに既存記事がある場合も、CMSへ移行した記事だけがこの一覧に表示されます。</p>
                <button
                  className="dads-button"
                  data-size="md"
                  data-type="solid-fill"
                  disabled={!canCreate}
                  onClick={onCreate}
                  type="button"
                >
                  最初の記事を書く
                </button>
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
                    actionLabel={articleActionLabel}
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

        {connection.kind === "ready" ? (
          <p className="studio-library__identity">
            <span>ログイン中</span>
            <strong>{cmsRoleLabels[connection.role]}</strong>
            <span>{connection.email}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
