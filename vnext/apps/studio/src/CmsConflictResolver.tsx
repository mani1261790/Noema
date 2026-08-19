import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ArticleFrontmatter } from "@noema/content";
import type { CmsArticleDetail, CmsVisibility } from "@noema/cms";
import {
  buildCmsBodyConflictBlocks,
  changedCmsMetadataFields,
  mergeCmsBodyConflictBlocks,
  mergeCmsConflictFrontmatter,
  type CmsConflictChoice,
  type CmsConflictMetadataChoices
} from "./cms-conflict";

const metadataLabels: Record<keyof ArticleFrontmatter, string> = {
  approach: "記事の型",
  authors: "著者",
  description: "説明",
  estimatedMinutes: "読了時間",
  heroImage: "ヒーロー画像",
  outcome: "読後にできること",
  prerequisites: "前提知識",
  publishedAt: "公開日",
  slug: "スラッグ",
  sources: "出典",
  status: "原稿状態",
  tags: "タグ",
  title: "タイトル",
  topics: "トピック",
  updatedAt: "更新日"
};

export interface ResolvedCmsConflictDraft {
  body: string;
  frontmatter: ArticleFrontmatter;
  visibility: CmsVisibility;
}

type LatestState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { article: CmsArticleDetail; kind: "ready" };

export function CmsConflictResolver({
  busy,
  latestState,
  localBody,
  localFrontmatter,
  localVisibility,
  onDownload,
  onResolve,
  onRetry,
  onUseLatest
}: {
  busy: boolean;
  latestState: LatestState;
  localBody: string;
  localFrontmatter: ArticleFrontmatter;
  localVisibility: CmsVisibility;
  onDownload: () => void;
  onResolve: (draft: ResolvedCmsConflictDraft) => void;
  onRetry: () => void;
  onUseLatest: (article: CmsArticleDetail) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [latestState.kind]);

  if (latestState.kind === "loading") {
    return (
      <section aria-labelledby="cms-conflict-heading" aria-live="polite" className="studio-conflict-resolver">
        <h2 id="cms-conflict-heading" ref={headingRef} tabIndex={-1}>保存競合を確認しています</h2>
        <p>ブラウザの入力は保持したまま、CMSの最新版を読み込んでいます。</p>
      </section>
    );
  }

  if (latestState.kind === "error") {
    return (
      <section aria-labelledby="cms-conflict-heading" className="studio-conflict-resolver is-error">
        <h2 id="cms-conflict-heading" ref={headingRef} tabIndex={-1}>CMSの最新版を読み込めませんでした</h2>
        <p>{latestState.message} ブラウザの入力は保持しています。</p>
        <div className="studio-conflict-resolver__actions">
          <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy} onClick={onRetry} type="button">もう一度読み込む</button>
          <button className="dads-button" data-size="md" data-type="outline" onClick={onDownload} type="button">ブラウザの原稿を書き出す</button>
        </div>
      </section>
    );
  }

  return (
    <CmsConflictComparison
      article={latestState.article}
      busy={busy}
      headingRef={headingRef}
      localBody={localBody}
      localFrontmatter={localFrontmatter}
      localVisibility={localVisibility}
      onDownload={onDownload}
      onResolve={onResolve}
      onUseLatest={onUseLatest}
    />
  );
}

function CmsConflictComparison({
  article,
  busy,
  headingRef,
  localBody,
  localFrontmatter,
  localVisibility,
  onDownload,
  onResolve,
  onUseLatest
}: {
  article: CmsArticleDetail;
  busy: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  localBody: string;
  localFrontmatter: ArticleFrontmatter;
  localVisibility: CmsVisibility;
  onDownload: () => void;
  onResolve: (draft: ResolvedCmsConflictDraft) => void;
  onUseLatest: (article: CmsArticleDetail) => void;
}) {
  const latestFrontmatter = useMemo(() => ({
    ...article.currentRevision.frontmatter,
    status: "draft" as const
  }), [article]);
  const metadataFields = useMemo(
    () => changedCmsMetadataFields(localFrontmatter, latestFrontmatter),
    [latestFrontmatter, localFrontmatter]
  );
  const bodyBlocks = useMemo(
    () => buildCmsBodyConflictBlocks(localBody, article.currentRevision.markdown),
    [article.currentRevision.markdown, localBody]
  );
  const choiceBlocks = bodyBlocks.filter((block) => block.kind === "choice");
  const [metadataChoices, setMetadataChoices] = useState<CmsConflictMetadataChoices>({});
  const [bodyChoices, setBodyChoices] = useState<Record<string, CmsConflictChoice>>({});
  const [visibilityChoice, setVisibilityChoice] = useState<CmsConflictChoice>("local");

  useEffect(() => {
    setMetadataChoices({});
    setBodyChoices({});
    setVisibilityChoice("local");
  }, [article.lockVersion]);

  const resolveSelection = (force?: CmsConflictChoice) => {
    const forcedMetadata = force
      ? Object.fromEntries(metadataFields.map((field) => [field, force])) as CmsConflictMetadataChoices
      : metadataChoices;
    const forcedBody = force
      ? Object.fromEntries(choiceBlocks.map((block) => [block.id, force]))
      : bodyChoices;
    onResolve({
      body: mergeCmsBodyConflictBlocks(bodyBlocks, forcedBody),
      frontmatter: mergeCmsConflictFrontmatter(localFrontmatter, latestFrontmatter, forcedMetadata),
      visibility: (force ?? visibilityChoice) === "local" ? localVisibility : article.visibility
    });
  };

  return (
    <section aria-labelledby="cms-conflict-heading" className="studio-conflict-resolver">
      <div className="studio-conflict-resolver__intro">
        <p className="studio-conflict-resolver__eyebrow">保存を止めています</p>
        <h2 id="cms-conflict-heading" ref={headingRef} tabIndex={-1}>ブラウザの原稿とCMS最新版を統合してください</h2>
        <p>どちらか一方をそのまま採用するか、変更箇所ごとに残す内容を選べます。選択した内容はすぐには保存せず、編集画面へ戻します。</p>
      </div>

      <div className="studio-conflict-resolver__versions">
        <article>
          <strong>ブラウザの原稿</strong>
          <span>入力中・未保存</span>
          <small>{localBody.length.toLocaleString("ja-JP")}文字</small>
        </article>
        <article>
          <strong>CMS最新版</strong>
          <span>revision {article.revisionNumber}</span>
          <small>{article.updatedByEmail}・{formatUpdatedAt(article.updatedAt)}</small>
        </article>
      </div>

      <div className="studio-conflict-resolver__quick-actions">
        <button className="dads-button" data-size="md" data-type="outline" disabled={busy} onClick={() => resolveSelection("local")} type="button">ブラウザの原稿を採用</button>
        <button className="dads-button" data-size="md" data-type="outline" disabled={busy} onClick={() => onUseLatest(article)} type="button">CMS最新版を採用</button>
        <button className="dads-button" data-size="md" data-type="outline" onClick={onDownload} type="button">ブラウザの原稿を書き出す</button>
      </div>

      <details className="studio-conflict-resolver__details" open>
        <summary>変更箇所を比較して統合する</summary>
        <div className="studio-conflict-resolver__details-body">
          <h3>記事情報</h3>
          {metadataFields.length === 0 && localVisibility === article.visibility ? (
            <p>記事情報の差はありません。</p>
          ) : null}
          {metadataFields.map((field) => (
            <ConflictChoiceField
              key={field}
              label={metadataLabels[field]}
              latestValue={formatMetadataValue(latestFrontmatter[field])}
              localValue={formatMetadataValue(localFrontmatter[field])}
              name={`metadata-${field}`}
              onChange={(choice) => setMetadataChoices((current) => ({ ...current, [field]: choice }))}
              value={metadataChoices[field] ?? "local"}
            />
          ))}
          {localVisibility !== article.visibility ? (
            <ConflictChoiceField
              label="公開範囲"
              latestValue={article.visibility}
              localValue={localVisibility}
              name="metadata-visibility"
              onChange={setVisibilityChoice}
              value={visibilityChoice}
            />
          ) : null}

          <h3>本文</h3>
          {choiceBlocks.length === 0 ? <p>本文の差はありません。</p> : (
            <p>{choiceBlocks.length}か所の差があります。変更箇所ごとに残す内容を選んでください。</p>
          )}
          <div className="studio-conflict-resolver__body-differences">
            {choiceBlocks.map((block, index) => (
              <ConflictChoiceField
                key={block.id}
                label={`本文の変更 ${index + 1}`}
                latestValue={block.latestText || "（CMS側にはありません）"}
                localValue={block.localText || "（ブラウザ側にはありません）"}
                name={`body-${block.id}`}
                onChange={(choice) => setBodyChoices((current) => ({ ...current, [block.id]: choice }))}
                value={bodyChoices[block.id] ?? "local"}
              />
            ))}
          </div>

          <div className="studio-conflict-resolver__actions">
            <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy} onClick={() => resolveSelection()} type="button">選んだ内容を編集画面へ戻す</button>
            <button className="dads-button" data-size="md" data-type="outline" onClick={onDownload} type="button">先にMarkdownを書き出す</button>
          </div>
        </div>
      </details>
    </section>
  );
}

function ConflictChoiceField({
  label,
  latestValue,
  localValue,
  name,
  onChange,
  value
}: {
  label: string;
  latestValue: string;
  localValue: string;
  name: string;
  onChange: (choice: CmsConflictChoice) => void;
  value: CmsConflictChoice;
}) {
  return (
    <fieldset className="studio-conflict-choice">
      <legend>{label}</legend>
      <div className="studio-conflict-choice__options">
        <label className={value === "local" ? "is-selected" : ""}>
          <span><input checked={value === "local"} name={name} onChange={() => onChange("local")} type="radio" /> ブラウザ側を使う</span>
          <pre>{localValue}</pre>
        </label>
        <label className={value === "latest" ? "is-selected" : ""}>
          <span><input checked={value === "latest"} name={name} onChange={() => onChange("latest")} type="radio" /> CMS側を使う</span>
          <pre>{latestValue}</pre>
        </label>
      </div>
    </fieldset>
  );
}

function formatMetadataValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "（なし）";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length > 0 ? value.join("、") : "（なし）";
  }
  return JSON.stringify(value, null, 2);
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
