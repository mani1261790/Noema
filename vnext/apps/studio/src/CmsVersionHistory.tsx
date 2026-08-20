import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  CmsArticleDetail,
  CmsArticleVersionDetail,
  CmsArticleVersionSummary,
  CmsRevisionSaveReason,
  CmsVisibility
} from "@noema/cms";
import type { ArticleFrontmatter } from "@noema/content";
import { buildCmsBodyConflictBlocks, changedCmsMetadataFields } from "./cms-conflict";
import { fetchCmsArticleVersion, fetchCmsArticleVersions } from "./cms-client";
import { StudioSurfaceHeader } from "./StudioSurfaceHeader";

const reasonLabels: Record<CmsRevisionSaveReason, string> = {
  autosave: "編集セッション",
  conflict_resolution: "競合を解消",
  created: "記事を作成",
  legacy: "以前の保存",
  manual: "手動で記録",
  restored: "過去の版から復元"
};

const metadataLabels: Partial<Record<keyof ArticleFrontmatter, string>> = {
  approach: "記事タイプ",
  authors: "執筆者",
  description: "概要",
  estimatedMinutes: "読了時間",
  heroImage: "記事画像",
  outcome: "読後の到達点",
  prerequisites: "前提知識",
  publishedAt: "公開日",
  slug: "スラッグ",
  sources: "参考資料",
  tags: "タグ",
  title: "タイトル",
  topics: "テーマ",
  updatedAt: "更新日"
};

type HistoryState =
  | { kind: "loading" }
  | { error: string; kind: "error" }
  | { kind: "ready"; versions: CmsArticleVersionSummary[] };

type VersionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { error: string; kind: "error" }
  | { kind: "ready"; version: CmsArticleVersionDetail };

export function CmsVersionHistory({
  article,
  hasUnsavedChanges,
  onClose,
  onRestore
}: {
  article: CmsArticleDetail;
  hasUnsavedChanges: boolean;
  onClose: () => void;
  onRestore: (version: CmsArticleVersionDetail) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const [refresh, setRefresh] = useState(0);
  const [historyState, setHistoryState] = useState<HistoryState>({ kind: "loading" });
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [versionState, setVersionState] = useState<VersionState>({ kind: "idle" });
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"
      ) ?? []).filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryState({ kind: "loading" });
    void fetchCmsArticleVersions(article.id, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setHistoryState({ error: result.error.message, kind: "error" });
        return;
      }
      setHistoryState({ kind: "ready", versions: result.value });
      setSelectedRevisionId((current) => current ?? result.value[0]?.latestRevisionId ?? null);
    });
    return () => controller.abort();
  }, [article.id, refresh]);

  useEffect(() => {
    if (!selectedRevisionId) {
      setVersionState({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    setConfirmingRestore(false);
    setVersionState({ kind: "loading" });
    void fetchCmsArticleVersion(article.id, selectedRevisionId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setVersionState(result.ok
        ? { kind: "ready", version: result.value }
        : { error: result.error.message, kind: "error" });
    });
    return () => controller.abort();
  }, [article.id, selectedRevisionId]);

  useEffect(() => {
    if (confirmingRestore) confirmRef.current?.focus();
  }, [confirmingRestore]);

  return (
    <section
      aria-labelledby="cms-version-history-heading"
      aria-modal="true"
      className="studio-version-history"
      id="cms-version-history"
      ref={dialogRef}
      role="dialog"
    >
      <StudioSurfaceHeader
        description="自動保存は編集セッション単位でまとめています。過去の内容は消さずに、新しい版として復元できます。"
        headingRef={headingRef}
        onClose={onClose}
        title="版の履歴"
        titleId="cms-version-history-heading"
      />
      <div className="studio-version-history__layout">
        <div className="studio-version-history__list" aria-label="保存された版">
          {historyState.kind === "loading" ? <p role="status">履歴を読み込んでいます…</p> : null}
          {historyState.kind === "error" ? (
            <div className="studio-version-history__error" role="alert">
              <p>{historyState.error}</p>
              <button className="dads-button" data-size="sm" data-type="outline" onClick={() => setRefresh((value) => value + 1)} type="button">もう一度読み込む</button>
            </div>
          ) : null}
          {historyState.kind === "ready" ? (
            <ol>
              {historyState.versions.map((version) => (
                <li key={version.id}>
                  <button
                    aria-current={selectedRevisionId === version.latestRevisionId ? "true" : undefined}
                    className={selectedRevisionId === version.latestRevisionId ? "is-selected" : ""}
                    onClick={() => setSelectedRevisionId(version.latestRevisionId)}
                    type="button"
                  >
                    <span className="studio-version-history__version-heading">
                      <strong>revision {version.latestRevisionNumber}</strong>
                      <span>{reasonLabels[version.reason]}</span>
                    </span>
                    <span>{formatDateTime(version.updatedAt)}・{version.createdByEmail}</span>
                    <small>{version.checkpointCount === 1 ? "1回の保存" : `${version.checkpointCount}回の自動保存をまとめています`}</small>
                    <span className="studio-version-history__badges">
                      {version.isCurrent ? <em>現在編集中</em> : null}
                      {version.isApproved ? <em>承認済み</em> : null}
                      {version.isPublished ? <em>公開中</em> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <VersionComparison
          article={article}
          confirmingRestore={confirmingRestore}
          confirmRef={confirmRef}
          hasUnsavedChanges={hasUnsavedChanges}
          onCancelRestore={() => setConfirmingRestore(false)}
          onConfirmRestore={(version) => onRestore(version)}
          onStartRestore={() => setConfirmingRestore(true)}
          state={versionState}
        />
      </div>
    </section>
  );
}

function VersionComparison({
  article,
  confirmingRestore,
  confirmRef,
  hasUnsavedChanges,
  onCancelRestore,
  onConfirmRestore,
  onStartRestore,
  state
}: {
  article: CmsArticleDetail;
  confirmingRestore: boolean;
  confirmRef: RefObject<HTMLHeadingElement | null>;
  hasUnsavedChanges: boolean;
  onCancelRestore: () => void;
  onConfirmRestore: (version: CmsArticleVersionDetail) => void;
  onStartRestore: () => void;
  state: VersionState;
}) {
  const comparison = useMemo(() => {
    if (state.kind !== "ready") return null;
    return {
      bodyChanges: buildCmsBodyConflictBlocks(
        state.version.revision.markdown,
        article.currentRevision.markdown
      ).filter((block) => block.kind === "choice"),
      metadataFields: changedCmsMetadataFields(
        state.version.revision.frontmatter,
        article.currentRevision.frontmatter
      )
    };
  }, [article.currentRevision, state]);

  if (state.kind === "idle" || state.kind === "loading") {
    return <div className="studio-version-history__detail"><p role="status">版の内容を読み込んでいます…</p></div>;
  }
  if (state.kind === "error") {
    return <div className="studio-version-history__detail" role="alert"><p>{state.error}</p></div>;
  }
  const { version } = state;
  const sameAsCurrent = version.revision.id === article.currentRevision.id;
  return (
    <article className="studio-version-history__detail">
      <header>
        <p className="studio-version-history__eyebrow">選択した版</p>
        <h3>revision {version.revision.number}</h3>
        <p>{formatDateTime(version.revision.createdAt)}・{version.revision.createdByEmail}</p>
      </header>
      <dl className="studio-version-history__summary">
        <div><dt>タイトル</dt><dd>{version.revision.frontmatter.title || "（未入力）"}</dd></div>
        <div><dt>本文</dt><dd>{version.revision.markdown.length.toLocaleString("ja-JP")}文字</dd></div>
        <div><dt>現在版との差</dt><dd>{comparison?.metadataFields.length ?? 0}項目・本文{comparison?.bodyChanges.length ?? 0}か所</dd></div>
        <div><dt>公開範囲</dt><dd>{formatVisibility(version.visibility)}</dd></div>
      </dl>
      {comparison && (comparison.metadataFields.length > 0 || comparison.bodyChanges.length > 0) ? (
        <details className="studio-version-history__changes">
          <summary>現在版との差分を見る</summary>
          {comparison.metadataFields.length > 0 ? (
            <p><strong>記事情報:</strong> {comparison.metadataFields.map((field) => metadataLabels[field] ?? field).join("、")}</p>
          ) : <p>記事情報の差はありません。</p>}
          {comparison.bodyChanges.map((block, index) => (
            <div className="studio-version-history__body-change" key={block.id}>
              <h4>本文の変更 {index + 1}</h4>
              <div><strong>選択した版</strong><pre tabIndex={0}>{block.localText || "（内容なし）"}</pre></div>
              <div><strong>現在版</strong><pre tabIndex={0}>{block.latestText || "（内容なし）"}</pre></div>
            </div>
          ))}
        </details>
      ) : <p>この版は現在版と同じ内容です。</p>}
      {!sameAsCurrent && !confirmingRestore ? (
        <button className="dads-button" data-size="md" data-type="solid-fill" onClick={onStartRestore} type="button">この版をもとに編集</button>
      ) : null}
      {confirmingRestore ? (
        <section aria-labelledby="cms-version-restore-heading" className="studio-version-history__confirm">
          <h4 id="cms-version-restore-heading" ref={confirmRef} tabIndex={-1}>この版を編集画面へ戻しますか？</h4>
          <p>{hasUnsavedChanges ? "現在の未保存入力は選択した版で置き換わります。" : "現在の編集内容を選択した版で置き換えます。"} CMSにはまだ保存せず、確認後に新しい版として記録します。</p>
          <div>
            <button className="dads-button" data-size="md" data-type="solid-fill" onClick={() => onConfirmRestore(version)} type="button">編集画面へ戻す</button>
            <button className="dads-button" data-size="md" data-type="outline" onClick={onCancelRestore} type="button">キャンセル</button>
          </div>
        </section>
      ) : null}
    </article>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatVisibility(value: CmsVisibility | null): string {
  if (value === null) return "記録なし（復元時は現在の設定を維持）";
  return {
    internal: "運営メンバーのみ",
    public: "一般公開",
    restricted: "指定メンバー",
    unlisted: "限定URL"
  }[value];
}
