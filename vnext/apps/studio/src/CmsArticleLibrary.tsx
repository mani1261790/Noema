import { useDeferredValue, useMemo, useState } from "react";
import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsRoleLabels,
  cmsVisibilityLabels,
  type CmsArticleSummary,
  type CmsRole
} from "@noema/cms";
import {
  cmsArticleFilterOptions,
  filterCmsArticles,
  type CmsArticleFilter
} from "./article-library";

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
  hasRecoveryDraft: boolean;
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
  onRetry: () => void;
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
  onEdit
}: {
  article: CmsArticleSummary;
  busy: boolean;
  canOpen: boolean;
  opening: boolean;
  recoveryNeedsArticleAssociation: boolean;
  onEdit: (articleId: string) => void;
}) {
  const title = article.title.trim() || "無題の記事";
  return (
    <li className="studio-library-item">
      <div className="studio-library-item__main">
        <div className="studio-library-item__status" aria-label="記事の状態">
          <span className={`is-review-${article.reviewStatus}`}>
            {cmsReviewStatusLabels[article.reviewStatus]}
          </span>
          <span className={`is-publication-${article.publicationStatus}`}>
            {cmsPublicationStatusLabels[article.publicationStatus]}
          </span>
          <span>{cmsVisibilityLabels[article.visibility]}</span>
        </div>
        <h3>{title}</h3>
        <p className="studio-library-item__slug">
          <span>スラッグ</span> {article.slug || "未設定"}
          <span aria-hidden="true"> · </span>
          revision {article.revisionNumber}
        </p>
        <p className="studio-library-item__updated">
          <time dateTime={article.updatedAt}>{formatArticleDate(article.updatedAt)}</time>
          <span>{article.updatedByEmail}</span>
        </p>
      </div>
      <button
        aria-label={opening
          ? `「${title}」を開いています`
          : recoveryNeedsArticleAssociation
            ? `復旧原稿を「${title}」に引き継ぐ`
            : `「${title}」を編集する`}
        className="dads-button studio-library-item__edit"
        data-size="md"
        data-type="outline"
        disabled={busy || !canOpen}
        onClick={() => onEdit(article.id)}
        type="button"
      >
        {opening ? "開いています…" : recoveryNeedsArticleAssociation ? "この内容を引き継ぐ" : "編集する"}
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
  hasRecoveryDraft,
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
  onRetry
}: CmsArticleLibraryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CmsArticleFilter>("all");
  const deferredQuery = useDeferredValue(query);
  const visibleArticles = useMemo(
    () => filterCmsArticles(articles, deferredQuery, filter),
    [articles, deferredQuery, filter]
  );
  const hasConditions = query.trim().length > 0 || filter !== "all";
  const clearConditions = () => {
    setQuery("");
    setFilter("all");
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
            <p className="studio-library__eyebrow">記事管理</p>
            <h1 id="studio-article-library-heading" tabIndex={-1}>記事</h1>
            <p>新しい記事を書くか、保存済みの記事を選んで編集を続けます。</p>
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

        {connection.kind === "ready" ? (
          <p className="studio-library__identity">
            <strong>{cmsRoleLabels[connection.role]}</strong>
            <span>{connection.email}</span>
          </p>
        ) : null}

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
            <p>復旧原稿がある場合は、上の復旧原稿から内容の確認やMarkdown書き出しを続けられます。</p>
            <button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">
              もう一度確認
            </button>
          </section>
        ) : null}

        {connection.kind === "ready" ? (
          <section aria-labelledby="studio-saved-articles-heading" className="studio-library__saved">
            <div className="studio-library__saved-heading">
              <div>
                <h2 id="studio-saved-articles-heading">CMSに保存した記事</h2>
                <p>タイトル、スラッグ、更新者で検索できます。</p>
              </div>
              <p aria-live="polite" className="studio-library__count">
                {visibleArticles.length} / {articles.length}件
              </p>
            </div>

            {articles.length > 0 ? (
              <div className="studio-library-controls">
                <label htmlFor="studio-article-search">記事を検索</label>
                <input
                  id="studio-article-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="タイトル、スラッグ、更新者"
                  type="search"
                  value={query}
                />
                <fieldset>
                  <legend>状態で絞り込む</legend>
                  <div className="studio-library-filters">
                    {cmsArticleFilterOptions.map((option) => (
                      <button
                        aria-pressed={filter === option.value}
                        key={option.value}
                        onClick={() => setFilter(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            ) : null}

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
                <p>検索語や状態を変えると、別の記事を探せます。</p>
                <button className="dads-button" data-size="md" data-type="outline" onClick={clearConditions} type="button">
                  検索条件をクリア
                </button>
              </div>
            ) : (
              <ul className="studio-library-list">
                {visibleArticles.map((article) => (
                  <CmsArticleListItem
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
            {hasConditions && visibleArticles.length > 0 ? (
              <button className="studio-library__clear" onClick={clearConditions} type="button">
                検索条件をクリア
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
