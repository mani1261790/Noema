import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CmsArticleSummary, CmsSeries, CmsSeriesVersion } from "@noema/cms";
import type { CmsSeriesContent } from "./cms-client";

function stableSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6).padStart(6, "0");
}

export function suggestSeriesSlug(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  return ascii.length >= 3 ? ascii : `series-${stableSuffix(title)}`;
}

export function CmsArticleSeriesEditor({
  articleId,
  articles,
  busy,
  canEdit,
  error,
  onDelete,
  onLoadVersions,
  onMerge,
  onSave,
  series
}: {
  articleId: string;
  articles: CmsArticleSummary[];
  busy: boolean;
  canEdit: boolean;
  error: string | null;
  onDelete: (series: CmsSeries) => Promise<boolean>;
  onLoadVersions: (seriesId: string) => Promise<CmsSeriesVersion[]>;
  onMerge: (source: CmsSeries, target: CmsSeries, articleIds: string[]) => Promise<CmsSeries | null>;
  onSave: (
    current: CmsSeries | null,
    content: CmsSeriesContent,
    restoredFromRevisionId?: string
  ) => Promise<CmsSeries | null>;
  series: CmsSeries[];
}) {
  const membership = useMemo(
    () => series.find((item) => item.articleIds.includes(articleId)) ?? null,
    [articleId, series]
  );
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [title, setTitle] = useState(() => membership?.title ?? "");
  const [description, setDescription] = useState(() => membership?.description ?? "");
  const [slug, setSlug] = useState(() => membership?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(() => Boolean(membership));
  const [articleIds, setArticleIds] = useState<string[]>(() => membership?.articleIds ?? []);
  const [versions, setVersions] = useState<CmsSeriesVersion[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const articlesById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles]
  );
  const publishedArticle = articlesById.get(articleId)?.publicationStatus === "published";
  const addToExistingLabel = publishedArticle ? "追加して公開へ反映" : "このシリーズへ追加";
  const createSeriesLabel = publishedArticle ? "シリーズを作成して公開へ反映" : "シリーズを作成して追加";
  const saveSeriesLabel = publishedArticle ? "シリーズを保存して公開へ反映" : "シリーズを保存";

  useEffect(() => {
    setTitle(membership?.title ?? "");
    setDescription(membership?.description ?? "");
    setSlug(membership?.slug ?? "");
    setSlugEdited(Boolean(membership));
    setArticleIds(membership?.articleIds ?? []);
    setVersions(null);
    setMergeTargetId("");
  }, [membership?.id, membership?.lockVersion]);

  const moveCurrentArticle = (offset: number) => {
    setArticleIds((current) => {
      const index = current.indexOf(articleId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  };

  const saveMembership = async (event: FormEvent) => {
    event.preventDefault();
    if (!membership) return;
    await onSave(membership, { articleIds, description, slug, title });
  };

  const addToExisting = async () => {
    const target = series.find((item) => item.id === selectedSeriesId);
    if (!target || target.articleIds.includes(articleId)) return;
    const saved = await onSave(target, {
      articleIds: [...target.articleIds, articleId],
      description: target.description,
      slug: target.slug,
      title: target.title
    });
    if (saved) setSelectedSeriesId("");
  };

  const createSeries = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    await onSave(null, {
      articleIds: [articleId],
      description: description.trim() || `${nextTitle}を順番に読むシリーズです。`,
      slug: slug.trim() || suggestSeriesSlug(nextTitle),
      title: nextTitle
    });
  };

  const toggleHistory = async () => {
    if (!membership) return;
    if (versions) {
      setVersions(null);
      return;
    }
    setHistoryBusy(true);
    try {
      setVersions(await onLoadVersions(membership.id));
    } finally {
      setHistoryBusy(false);
    }
  };

  const restore = async (version: CmsSeriesVersion) => {
    if (!membership || !window.confirm(`revision ${version.number}のシリーズ構成を復元しますか？`)) return;
    await onSave(membership, {
      articleIds: version.articleIds,
      description: version.description,
      slug: version.slug,
      title: version.title
    }, version.id);
  };

  const removeFromSeries = async () => {
    if (!membership) return;
    const leavesEmpty = articleIds.length === 1;
    if (!window.confirm(
      leavesEmpty
        ? `この記事を「${membership.title}」から外しますか？ シリーズは空の状態で残り、あとから削除できます。`
        : `この記事を「${membership.title}」から外しますか？ シリーズ履歴から復元できます。`
    )) return;
    await onSave(membership, {
      articleIds: articleIds.filter((id) => id !== articleId),
      description,
      slug,
      title
    });
  };

  const mergeIntoExisting = async () => {
    if (!membership) return;
    const target = series.find((item) => item.id === mergeTargetId);
    if (!target || target.id === membership.id) return;
    if (!window.confirm(
      `「${membership.title}」を「${target.title}」へ統合しますか？ ` +
      "統合元シリーズは削除され、記事は統合先の末尾へ追加されます。この操作は取り消せません。"
    )) return;
    const merged = await onMerge(
      membership,
      target,
      [...target.articleIds, ...membership.articleIds]
    );
    if (merged) setMergeTargetId("");
  };

  const emptySeries = series.filter((item) => item.articleIds.length === 0);

  if (!membership) {
    return (
      <section className="studio-article-series" aria-labelledby="article-series-setting-heading">
        <div className="studio-article-series__heading">
          <div>
            <h3 id="article-series-setting-heading">シリーズ</h3>
            <p>未設定です。既存の読む順序へ追加するか、この場で新しく作れます。</p>
          </div>
        </div>
        {error ? <p className="studio-article-series__error" role="alert">{error}</p> : null}
        <div className="studio-article-series__existing">
          <label htmlFor="article-series-existing">既存シリーズ</label>
          <select disabled={!canEdit || busy} id="article-series-existing" onChange={(event) => setSelectedSeriesId(event.target.value)} value={selectedSeriesId}>
            <option value="">選択してください</option>
            {series.map((item) => <option key={item.id} value={item.id}>{item.title}（{item.articleIds.length}記事）</option>)}
          </select>
          <button className="dads-button" data-size="md" data-type="outline" disabled={!canEdit || busy || !selectedSeriesId} onClick={() => void addToExisting()} type="button">{addToExistingLabel}</button>
        </div>
        <details className="studio-disclosure">
          <summary>新しいシリーズを作る</summary>
          <form className="studio-article-series__form" onSubmit={(event) => void createSeries(event)}>
            <label>シリーズ名<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => { setTitle(event.target.value); if (!slugEdited) setSlug(suggestSeriesSlug(event.target.value)); }} required value={title} /></label>
            <label>説明<textarea disabled={!canEdit || busy} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="空欄ならシリーズ名から自動で補います。" rows={3} value={description} /></label>
            <details>
              <summary>URLを確認</summary>
              <label>slug<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={slug} /></label>
            </details>
            <button className="dads-button" data-size="md" data-type="solid-fill" disabled={!canEdit || busy || !title.trim()} type="submit">{createSeriesLabel}</button>
          </form>
        </details>
        <EmptySeriesCleanup
          busy={busy}
          canEdit={canEdit}
          onDelete={onDelete}
          series={emptySeries}
        />
      </section>
    );
  }

  const currentIndex = articleIds.indexOf(articleId);
  return (
    <section className="studio-article-series" aria-labelledby="article-series-setting-heading">
      <div className="studio-article-series__heading">
        <div>
          <h3 id="article-series-setting-heading">シリーズ</h3>
          <p><strong>{membership.title}</strong> · 第{currentIndex + 1}回 / 全{articleIds.length}回</p>
        </div>
        <button className="dads-button" data-size="sm" data-type="outline" disabled={historyBusy} onClick={() => void toggleHistory()} type="button">{versions ? "履歴を閉じる" : "履歴と復元"}</button>
      </div>
      {error ? <p className="studio-article-series__error" role="alert">{error}</p> : null}
      {versions ? (
        <ol className="studio-article-series__history">
          {versions.map((version) => (
            <li key={version.id}>
              <span>revision {version.number} · {version.articleIds.length}記事</span>
              {version.isCurrent ? <strong>現在</strong> : <button disabled={busy} onClick={() => void restore(version)} type="button">復元</button>}
            </li>
          ))}
        </ol>
      ) : null}
      <form className="studio-article-series__form" onSubmit={(event) => void saveMembership(event)}>
        <div className="studio-article-series__position">
          <span>この記事の位置: 第{currentIndex + 1}回</span>
          <div>
            <button disabled={!canEdit || busy || currentIndex <= 0} onClick={() => moveCurrentArticle(-1)} type="button">前へ</button>
            <button disabled={!canEdit || busy || currentIndex < 0 || currentIndex >= articleIds.length - 1} onClick={() => moveCurrentArticle(1)} type="button">次へ</button>
          </div>
        </div>
        <details className="studio-disclosure">
          <summary>シリーズ情報を編集</summary>
          <label>シリーズ名<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
          <label>説明<textarea disabled={!canEdit || busy} maxLength={500} onChange={(event) => setDescription(event.target.value)} required rows={3} value={description} /></label>
          <label>slug<input disabled={!canEdit || busy} maxLength={100} onChange={(event) => setSlug(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={slug} /></label>
          <ol className="studio-article-series__order">
            {articleIds.map((id, index) => <li className={id === articleId ? "is-current" : ""} key={id}><span>{index + 1}</span>{articlesById.get(id)?.title || "記事が見つかりません"}</li>)}
          </ol>
        </details>
        <div className="studio-article-series__actions">
          <button className="dads-button" data-size="md" data-type="solid-fill" disabled={!canEdit || busy} type="submit">{saveSeriesLabel}</button>
          <button className="dads-button" data-size="md" data-type="outline" disabled={!canEdit || busy} onClick={() => void removeFromSeries()} type="button">この記事をシリーズから外す</button>
        </div>
        {articleIds.length === 1 ? <p className="studio-field__support">最後の記事も外せます。空になったシリーズは、この画面から削除できます。</p> : null}
      </form>
      {series.some((item) => item.id !== membership.id) ? (
        <details className="studio-disclosure studio-article-series__merge">
          <summary>別のシリーズへ統合</summary>
          <p>このシリーズの記事を統合先の末尾へ移し、このシリーズを削除します。</p>
          <label htmlFor="article-series-merge-target">統合先シリーズ</label>
          <select
            disabled={!canEdit || busy}
            id="article-series-merge-target"
            onChange={(event) => setMergeTargetId(event.target.value)}
            value={mergeTargetId}
          >
            <option value="">選択してください</option>
            {series.filter((item) => item.id !== membership.id).map((item) => (
              <option key={item.id} value={item.id}>{item.title}（{item.articleIds.length}記事）</option>
            ))}
          </select>
          <button
            className="dads-button"
            data-size="md"
            data-type="outline"
            disabled={!canEdit || busy || !mergeTargetId}
            onClick={() => void mergeIntoExisting()}
            type="button"
          >
            統合してこのシリーズを削除
          </button>
        </details>
      ) : null}
      <EmptySeriesCleanup
        busy={busy}
        canEdit={canEdit}
        onDelete={onDelete}
        series={emptySeries.filter((item) => item.id !== membership.id)}
      />
    </section>
  );
}

function EmptySeriesCleanup({
  busy,
  canEdit,
  onDelete,
  series
}: {
  busy: boolean;
  canEdit: boolean;
  onDelete: (series: CmsSeries) => Promise<boolean>;
  series: CmsSeries[];
}) {
  if (series.length === 0) return null;
  const remove = async (item: CmsSeries) => {
    if (!window.confirm(
      `空のシリーズ「${item.title}」を削除しますか？ シリーズ履歴も削除され、この操作は取り消せません。`
    )) return;
    await onDelete(item);
  };
  return (
    <section className="studio-article-series__empty" aria-labelledby="empty-series-heading">
      <div>
        <h4 id="empty-series-heading">空のシリーズ</h4>
        <p>記事の移行が終わったシリーズを削除できます。</p>
      </div>
      <ul>
        {series.map((item) => (
          <li key={item.id}>
            <span>{item.title}</span>
            <button
              className="dads-button"
              data-size="sm"
              data-type="outline"
              disabled={!canEdit || busy}
              onClick={() => void remove(item)}
              type="button"
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
