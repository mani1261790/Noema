import { useDeferredValue, useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  cmsPublicationStatusLabels,
  type CmsArticleSummary,
  type CmsSeries,
  type CmsSeriesVersion
} from "@noema/cms";
import type { CmsSeriesContent } from "./cms-client";
import type { CmsLibraryConnection } from "./CmsArticleLibrary";

export function CmsSeriesManager({
  articles,
  busy,
  canEdit,
  connection,
  error,
  onLoadVersions,
  onRetry,
  onSave,
  series
}: {
  articles: CmsArticleSummary[];
  busy: boolean;
  canEdit: boolean;
  connection: CmsLibraryConnection;
  error: string | null;
  onLoadVersions: (seriesId: string) => Promise<CmsSeriesVersion[]>;
  onRetry: () => void;
  onSave: (
    current: CmsSeries | null,
    content: CmsSeriesContent,
    restoredFromRevisionId?: string
  ) => Promise<CmsSeries | null>;
  series: CmsSeries[];
}) {
  const [current, setCurrent] = useState<CmsSeries | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [articleIds, setArticleIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [versions, setVersions] = useState<CmsSeriesVersion[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("ja-JP"));
  const connectionError = connection.kind === "unavailable" ? connection.message : null;
  const articlesById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles]
  );
  const membershipByArticleId = useMemo(
    () => new Map(series.flatMap((item) => item.articleIds.map((articleId) => [articleId, item] as const))),
    [series]
  );
  const selectedArticleIds = useMemo(() => new Set(articleIds), [articleIds]);
  const selectedArticles = articleIds.flatMap((id) => {
    const article = articlesById.get(id);
    return article ? [article] : [];
  });
  const availableArticles = articles.filter((article) => {
    if (selectedArticleIds.has(article.id)) return false;
    if (!deferredQuery) return true;
    return `${article.title} ${article.slug}`.toLocaleLowerCase("ja-JP").includes(deferredQuery);
  });

  const hasUnsavedChanges = current
    ? title !== current.title ||
      description !== current.description ||
      slug !== current.slug ||
      JSON.stringify(articleIds) !== JSON.stringify(current.articleIds)
    : Boolean(title || description || slug || articleIds.length);
  const unpublishedCount = selectedArticles.filter((article) =>
    article.publicationStatus !== "published" || article.visibility !== "public"
  ).length;

  const openSeries = (item: CmsSeries | null, force = false) => {
    if (!force && hasUnsavedChanges && !window.confirm("未保存のシリーズ変更を破棄して移動しますか？")) return;
    setCurrent(item);
    setTitle(item?.title ?? "");
    setDescription(item?.description ?? "");
    setSlug(item?.slug ?? "");
    setArticleIds(item?.articleIds ?? []);
    setVersions(null);
    setQuery("");
  };

  const move = (id: string, offset: number) => {
    setArticleIds((ids) => {
      const index = ids.indexOf(id);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;
      const next = [...ids];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  };

  const dropBefore = (event: DragEvent, targetId: string) => {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    setArticleIds((ids) => {
      const next = ids.filter((id) => id !== draggedId);
      const targetIndex = next.indexOf(targetId);
      next.splice(targetIndex, 0, draggedId);
      return next;
    });
    setDraggedId(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await onSave(current, { articleIds, description, slug, title });
    if (saved) openSeries(saved, true);
  };

  const loadHistory = async () => {
    if (!current) return;
    if (versions) {
      setVersions(null);
      return;
    }
    setHistoryBusy(true);
    setVersions(await onLoadVersions(current.id));
    setHistoryBusy(false);
  };

  const restore = async (version: CmsSeriesVersion) => {
    if (!current || !window.confirm(`revision ${version.number}の構成を新しいrevisionとして復元しますか？`)) return;
    const saved = await onSave(current, {
      articleIds: version.articleIds,
      description: version.description,
      slug: version.slug,
      title: version.title
    }, version.id);
    if (saved) openSeries(saved, true);
  };

  return (
    <section aria-labelledby="studio-series-heading" className="studio-series">
      <header className="studio-series__header">
        <div>
          <p className="studio-library__eyebrow">Series</p>
          <h1 id="studio-series-heading">シリーズ（体系）</h1>
          <p>記事の読む順序をまとめます。並べ替えは記事本体のrevisionには影響しません。</p>
        </div>
        {canEdit ? <button className="dads-button" data-size="md" data-type="solid-fill" onClick={() => openSeries(null)} type="button">新しいシリーズ</button> : null}
      </header>

      {connectionError || error ? (
        <div className="studio-series__error" role="alert">
          <p>{error ?? connectionError}</p>
          <button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">もう一度読み込む</button>
        </div>
      ) : null}

      <div className="studio-series__layout">
        <aside aria-label="シリーズ一覧" className="studio-series__list">
          {series.length === 0 ? <p>シリーズはまだありません。</p> : series.map((item) => (
            <button
              aria-current={current?.id === item.id ? "true" : undefined}
              className={current?.id === item.id ? "is-current" : ""}
              key={item.id}
              onClick={() => openSeries(item)}
              type="button"
            >
              <strong>{item.title}</strong>
              <span>{item.articleIds.length}記事・revision {item.revisionNumber}</span>
            </button>
          ))}
        </aside>

        <form className="studio-series__editor" onSubmit={(event) => void submit(event)}>
          <div className="studio-series__editor-heading">
            <div>
              <p>{current ? `revision ${current.revisionNumber}` : "新規"}</p>
              <h2>{current ? current.title : "シリーズを作成"}</h2>
            </div>
            {current ? <button className="dads-button" data-size="sm" data-type="outline" disabled={historyBusy} onClick={() => void loadHistory()} type="button">{versions ? "履歴を閉じる" : "履歴と復元"}</button> : null}
          </div>

          {versions ? (
            <section aria-labelledby="studio-series-history-heading" className="studio-series__history">
              <h3 id="studio-series-history-heading">シリーズ履歴</h3>
              <ol>
                {versions.map((version) => (
                  <li key={version.id}>
                    <div><strong>revision {version.number}</strong><span>{version.articleIds.length}記事・{new Date(version.createdAt).toLocaleString("ja-JP")}・{version.createdByEmail}</span></div>
                    {version.isCurrent ? <span>現在</span> : <button className="dads-button" data-size="sm" data-type="outline" disabled={busy} onClick={() => void restore(version)} type="button">この版を復元</button>}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <label>シリーズ名<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
          <label>説明<textarea disabled={!canEdit || busy} maxLength={500} onChange={(event) => setDescription(event.target.value)} required rows={3} value={description} /></label>
          <label>slug<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => setSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={slug} /></label>

          <fieldset className="studio-series__articles">
            <legend>記事の順番</legend>
            <p>ドラッグ、または「上へ」「下へ」で並べ替えられます。</p>
            {selectedArticles.length === 0 ? <p className="studio-series__empty">記事を1件以上追加してください。</p> : (
              <ol>
                {selectedArticles.map((article, index) => (
                  <li
                    draggable={canEdit && !busy}
                    key={article.id}
                    onDragEnd={() => setDraggedId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDragStart={() => setDraggedId(article.id)}
                    onDrop={(event) => dropBefore(event, article.id)}
                  >
                    <span aria-hidden="true" className="studio-series__position">{index + 1}</span>
                    <div><strong>{article.title || "無題の記事"}</strong><small>{cmsPublicationStatusLabels[article.publicationStatus]}・{article.visibility}</small></div>
                    <div className="studio-series__item-actions">
                      <button aria-label={`${article.title}を上へ`} disabled={busy || index === 0} onClick={() => move(article.id, -1)} type="button">上へ</button>
                      <button aria-label={`${article.title}を下へ`} disabled={busy || index === selectedArticles.length - 1} onClick={() => move(article.id, 1)} type="button">下へ</button>
                      <button aria-label={`${article.title}をシリーズから外す`} disabled={busy} onClick={() => setArticleIds((ids) => ids.filter((id) => id !== article.id))} type="button">外す</button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>

          <div className="studio-series__article-search">
            <label htmlFor="studio-series-article-query">記事を追加</label>
            <input id="studio-series-article-query" onChange={(event) => setQuery(event.target.value)} placeholder="タイトルまたはslugで検索" type="search" value={query} />
            <ul>
              {availableArticles.slice(0, 20).map((article) => (
                <li key={article.id}>
                  <span>{article.title || "無題の記事"}{membershipByArticleId.get(article.id) && membershipByArticleId.get(article.id)?.id !== current?.id ? `（「${membershipByArticleId.get(article.id)?.title}」に所属）` : ""}</span>
                  <button disabled={!canEdit || busy || (membershipByArticleId.has(article.id) && membershipByArticleId.get(article.id)?.id !== current?.id)} onClick={() => setArticleIds((ids) => [...ids, article.id])} type="button">追加</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="studio-series__save">
            <p>{unpublishedCount > 0
              ? `${unpublishedCount}件は未公開または一般公開ではないため、公開ナビゲーションには表示されません。`
              : "保存すると公開記事のシリーズナビゲーションへ反映され、以前の構成は履歴に残ります。"}</p>
            <button className="dads-button" data-size="md" data-type="solid-fill" disabled={!canEdit || busy || articleIds.length === 0} type="submit">{busy ? "保存中…" : "保存して公開"}</button>
          </div>
        </form>
      </div>
    </section>
  );
}
