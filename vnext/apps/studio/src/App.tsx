import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {
  articleFrontmatterSchema,
  approachLabels,
  parseArticle,
  previewArticleMarkdown,
  previewArticles,
  serializeArticle,
  topicLabels,
  validateArticleMarkdown,
  type ArticleMarkdownIssue,
  type ArticleFrontmatter
} from "@noema/content";

type Pane = "settings" | "write" | "preview";

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:4321";
const draftStorageKey = "noema-studio-draft-v1";
const initialArticle: ArticleFrontmatter = {
  ...previewArticles[0],
  status: "draft",
  authors: ["Noema編集部"]
};

function loadSavedDraft(): { frontmatter: ArticleFrontmatter; body: string } | null {
  try {
    const saved = localStorage.getItem(draftStorageKey);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as { frontmatter?: unknown; body?: unknown };
    const frontmatter = articleFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!frontmatter.success || typeof parsed.body !== "string") return null;
    return { frontmatter: frontmatter.data, body: parsed.body };
  } catch {
    return null;
  }
}

const savedDraft = loadSavedDraft();

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="studio-field">
      <label className="dads-form-control-label studio-field__label" htmlFor={id}>{label}</label>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function Icon({ name }: { name: "download" | "external" | "check" | "warning" }) {
  const paths = {
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3" /></>,
    external: <><path d="M14 4h6v6m0-6-9 9" /><path d="M18 13v7H4V6h7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3v1" /></>
  };
  return <svg className="studio-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function App() {
  const [frontmatter, setFrontmatter] = useState<ArticleFrontmatter>(savedDraft?.frontmatter ?? initialArticle);
  const [body, setBody] = useState(savedDraft?.body ?? previewArticleMarkdown.trim());
  const [activePane, setActivePane] = useState<Pane>("write");
  const [saveStatus, setSaveStatus] = useState(savedDraft ? "保存した下書きを復元しました" : "下書きは自動保存されます");
  const [operationMessage, setOperationMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const validationSection = useRef<HTMLElement>(null);
  const deferredBody = useDeferredValue(body);
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(markdown.render(deferredBody)),
    [deferredBody]
  );
  const validation = articleFrontmatterSchema.safeParse(frontmatter);
  const bodyIssues = useMemo(
    () => validateArticleMarkdown(deferredBody),
    [deferredBody]
  );
  const bodyErrors = bodyIssues.filter((issue) => issue.severity === "error");
  const frontmatterErrorCount = validation.success ? 0 : validation.error.issues.length;
  const blockingErrorCount = frontmatterErrorCount + bodyErrors.length;
  const editorialWarnings = [
    ...(frontmatter.sources.length === 0 ? ["出典がまだ登録されていません。"] : [])
  ];
  const canExport = validation.success && bodyErrors.length === 0;

  useEffect(() => {
    setSaveStatus("保存中…");
    const timer = window.setTimeout(() => {
      localStorage.setItem(draftStorageKey, JSON.stringify({ frontmatter, body }));
      setSaveStatus("このブラウザに保存済み");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [frontmatter, body]);

  const update = <K extends keyof ArticleFrontmatter>(key: K, value: ArticleFrontmatter[K]) => {
    setFrontmatter((current) => ({ ...current, [key]: value }));
  };

  const download = () => {
    const result = articleFrontmatterSchema.safeParse(frontmatter);
    const currentBodyErrors = validateArticleMarkdown(body).filter(
      (issue) => issue.severity === "error"
    );
    if (!result.success || currentBodyErrors.length > 0) return;
    const blob = new Blob([serializeArticle(result.data, body)], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${frontmatter.slug}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
    setOperationMessage(`${frontmatter.slug}.mdを書き出しました。`);
  };

  const importMarkdown = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = await parseArticle(await file.text());
      setFrontmatter(parsed.frontmatter);
      setBody(parsed.markdown);
      setOperationMessage(`${file.name}を読み込みました。`);
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "Markdownを読み込めませんでした。");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const resetDraft = () => {
    if (!window.confirm("現在の入力内容を破棄して、新しい記事を作成しますか？")) return;
    localStorage.removeItem(draftStorageKey);
    setFrontmatter(initialArticle);
    setBody("");
    setOperationMessage("新しい記事を作成します。");
  };

  const updateSource = (index: number, key: "title" | "url" | "checkedAt", value: string) => {
    update("sources", frontmatter.sources.map((source, sourceIndex) =>
      sourceIndex === index ? { ...source, [key]: value } : source
    ));
  };

  const focusBodyIssue = (issue: ArticleMarkdownIssue) => {
    setActivePane("write");
    window.requestAnimationFrame(() => {
      const input = bodyInput.current;
      if (!input) return;

      let start = 0;
      for (let line = 1; line < issue.line; line += 1) {
        const nextLine = body.indexOf("\n", start);
        if (nextLine < 0) break;
        start = nextLine + 1;
      }
      const nextLine = body.indexOf("\n", start);
      const end = nextLine < 0 ? body.length : nextLine;
      input.focus();
      input.setSelectionRange(start, end);
    });
  };

  const showValidation = () => {
    setActivePane("settings");
    window.requestAnimationFrame(() => {
      validationSection.current?.focus({ preventScroll: true });
      validationSection.current?.scrollIntoView({
        block: "center"
      });
    });
  };

  const issueFieldIds: Record<string, string> = {
    title: "article-title",
    description: "article-description",
    slug: "article-slug",
    status: "article-status",
    publishedAt: "article-published-at",
    updatedAt: "article-updated-at",
    authors: "article-authors",
    topics: "article-topic",
    approach: "article-approach",
    outcome: "article-outcome",
    estimatedMinutes: "article-minutes",
    heroImage: "article-hero-image",
    sources: "article-sources"
  };

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand__mark" aria-hidden="true">N</span>
          <span className="studio-brand__text">Noema <strong>Studio</strong><small>{saveStatus}</small></span>
        </div>
        <div className="studio-header__actions">
          <input ref={importInput} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => void importMarkdown(event.target.files?.[0])} />
          <button className="dads-button studio-import-button" data-size="md" data-type="outline" type="button" onClick={() => importInput.current?.click()}>
            <span className="studio-action-label--full">MDを読み込む</span><span className="studio-action-label--short">読込</span>
          </button>
          <a className="dads-button studio-public-link" data-size="md" data-type="outline" href={publicSiteUrl} target="_blank" rel="noreferrer">
            公開サイトを確認 <Icon name="external" />
          </a>
          <button className="dads-button studio-download-button" data-size="md" data-type="solid-fill" type="button" onClick={download} disabled={!canExport}>
            <span className="studio-action-label--full">Markdownを書き出す</span><span className="studio-action-label--short">書出</span> <Icon name="download" />
          </button>
        </div>
      </header>

      <nav className="studio-tabs" aria-label="編集画面">
        {(["settings", "write", "preview"] as Pane[]).map((pane) => (
          <button key={pane} type="button" aria-current={activePane === pane ? "page" : undefined} onClick={() => setActivePane(pane)}>
            {{ settings: "設定", write: "本文", preview: "プレビュー" }[pane]}
            {pane === "settings" && frontmatterErrorCount > 0 ? ` (${frontmatterErrorCount})` : ""}
            {pane === "write" && bodyErrors.length > 0 ? ` (${bodyErrors.length})` : ""}
          </button>
        ))}
      </nav>

      <main className="studio-workspace">
        <h1 className="sr-only">Noema Studio 記事エディター</h1>
        <aside className={`studio-settings ${activePane === "settings" ? "is-active" : ""}`} aria-label="記事設定">
          {operationMessage && <p className="studio-operation-message" role="status">{operationMessage}</p>}
          <div className="studio-pane-title">
            <p>ARTICLE SETTINGS</p>
            <h2>記事の設定</h2>
          </div>
          <Field id="article-title" label="タイトル" hint={`${frontmatter.title.length} / 100文字`}>
            <input id="article-title" className="dads-input-text" value={frontmatter.title} onChange={(event) => update("title", event.target.value)} />
          </Field>
          <Field id="article-description" label="概要" hint={`${frontmatter.description.length} / 180文字`}>
            <textarea id="article-description" className="dads-textarea" rows={4} value={frontmatter.description} onChange={(event) => update("description", event.target.value)} />
          </Field>
          <Field id="article-outcome" label="この記事でできるようになること" hint={`${frontmatter.outcome.length} / 180文字`}>
            <textarea id="article-outcome" className="dads-textarea" rows={3} value={frontmatter.outcome} onChange={(event) => update("outcome", event.target.value)} />
          </Field>
          <Field id="article-slug" label="スラッグ" hint="半角英数字とハイフン">
            <input id="article-slug" className="dads-input-text" value={frontmatter.slug} onChange={(event) => update("slug", event.target.value)} />
          </Field>
          <div className="studio-field-row studio-field-row--equal">
            <Field id="article-status" label="公開状態">
              <select id="article-status" value={frontmatter.status} onChange={(event) => update("status", event.target.value as ArticleFrontmatter["status"])}>
                <option value="draft">下書き</option>
                <option value="published">公開</option>
                <option value="archived">非公開・保管</option>
              </select>
            </Field>
            <Field id="article-authors" label="執筆者" hint="複数の場合はカンマ区切り">
              <input id="article-authors" className="dads-input-text" value={frontmatter.authors.join(", ")} onChange={(event) => update("authors", event.target.value.split(",").map((author) => author.trim()).filter(Boolean))} />
            </Field>
          </div>
          <div className="studio-field-row studio-field-row--equal">
            <Field id="article-published-at" label="公開日" hint="公開記事では必須">
              <input id="article-published-at" className="dads-input-text" type="date" value={frontmatter.publishedAt ?? ""} onChange={(event) => update("publishedAt", event.target.value || undefined)} />
            </Field>
            <Field id="article-updated-at" label="更新日">
              <input id="article-updated-at" className="dads-input-text" type="date" value={frontmatter.updatedAt} onChange={(event) => update("updatedAt", event.target.value)} />
            </Field>
          </div>
          <div className="studio-field-row">
            <Field id="article-approach" label="記事タイプ">
              <select id="article-approach" value={frontmatter.approach} onChange={(event) => update("approach", event.target.value as ArticleFrontmatter["approach"])}>
                {Object.entries(approachLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field id="article-minutes" label="読了時間">
              <input id="article-minutes" className="dads-input-text" type="number" min="1" max="180" value={frontmatter.estimatedMinutes} onChange={(event) => update("estimatedMinutes", Number(event.target.value))} />
            </Field>
          </div>
          <Field id="article-topic" label="テーマ" hint="記事が扱う話題を選びます">
            <select id="article-topic" value={frontmatter.topics[0]} onChange={(event) => update("topics", [event.target.value as ArticleFrontmatter["topics"][number]])}>
              {Object.entries(topicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field id="article-tags" label="タグ" hint="カンマ区切り">
            <input id="article-tags" className="dads-input-text" value={frontmatter.tags.join(", ")} onChange={(event) => update("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} />
          </Field>
          <Field id="article-prerequisites" label="前提知識" hint="不要な場合は空欄、複数ある場合はカンマ区切り">
            <input id="article-prerequisites" className="dads-input-text" value={frontmatter.prerequisites.join(", ")} onChange={(event) => update("prerequisites", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
          </Field>
          <Field id="article-hero-image" label="記事画像" hint="サイト内パスまたは画像URL。不要な場合は空欄">
            <input
              id="article-hero-image"
              className="dads-input-text"
              value={frontmatter.heroImage?.src ?? ""}
              onChange={(event) => update("heroImage", event.target.value.trim()
                ? { src: event.target.value.trim(), alt: frontmatter.heroImage?.alt ?? "" }
                : null)}
              placeholder="/images/articles/example.webp"
            />
          </Field>
          {frontmatter.heroImage && (
            <Field id="article-hero-image-alt" label="記事画像の代替テキスト" hint="画像から得られる情報を簡潔に説明します">
              <textarea id="article-hero-image-alt" className="dads-textarea" rows={3} value={frontmatter.heroImage.alt} onChange={(event) => update("heroImage", { ...frontmatter.heroImage!, alt: event.target.value })} />
            </Field>
          )}

          <fieldset id="article-sources" className="studio-sources">
            <legend>参考資料</legend>
            {frontmatter.sources.map((source, index) => (
              <div className="studio-source" key={index}>
                <Field id={`article-source-title-${index}`} label={`資料 ${index + 1} の名前`}>
                  <input id={`article-source-title-${index}`} className="dads-input-text" value={source.title} onChange={(event) => updateSource(index, "title", event.target.value)} />
                </Field>
                <Field id={`article-source-url-${index}`} label="URL">
                  <input id={`article-source-url-${index}`} className="dads-input-text" type="url" value={source.url} onChange={(event) => updateSource(index, "url", event.target.value)} />
                </Field>
                <Field id={`article-source-date-${index}`} label="確認日">
                  <input id={`article-source-date-${index}`} className="dads-input-text" type="date" value={source.checkedAt} onChange={(event) => updateSource(index, "checkedAt", event.target.value)} />
                </Field>
                <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => update("sources", frontmatter.sources.filter((_, sourceIndex) => sourceIndex !== index))}>この資料を削除</button>
              </div>
            ))}
            <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => update("sources", [...frontmatter.sources, { title: "", url: "", checkedAt: new Date().toISOString().slice(0, 10) }])}>参考資料を追加</button>
          </fieldset>

          <section ref={validationSection} id="article-validation" className="studio-validation" tabIndex={-1}>
            <h2>{canExport && bodyIssues.length === 0 && editorialWarnings.length === 0 ? <Icon name="check" /> : <Icon name="warning" />} 書き出し前チェック</h2>
            {!validation.success ? validation.error.issues.slice(0, 5).map((issue) => {
              const fieldId = issueFieldIds[String(issue.path[0])];
              return (
                <p className="studio-validation__error" key={`${issue.path.join(".")}-${issue.message}`}>
                  {fieldId ? <a href={`#${fieldId}`}>エラー — {issue.message}</a> : <>エラー — {issue.message}</>}
                </p>
              );
            }) : null}
            {bodyIssues.map((issue) => (
              <p className={`studio-validation__${issue.severity}`} key={`${issue.code}-${issue.line}-${issue.message}`}>
                <a href="#article-body" onClick={(event) => { event.preventDefault(); focusBodyIssue(issue); }}>
                  {issue.severity === "error" ? "エラー" : "確認"} — 本文{issue.line}行: {issue.message}
                </a>
              </p>
            ))}
            {editorialWarnings.map((warning) => <p className="studio-validation__warning" key={warning}>確認 — {warning}</p>)}
            {validation.success && bodyIssues.length === 0 && editorialWarnings.length === 0 ? <p>書き出しに必要な項目が揃っています。</p> : null}
          </section>
          <section className="studio-danger-zone">
            <h2>新しい記事を作る</h2>
            <p>現在の入力内容と、このブラウザに保存した下書きを破棄します。</p>
            <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={resetDraft}>入力内容を破棄</button>
          </section>
        </aside>

        <section className={`studio-editor ${activePane === "write" ? "is-active" : ""}`} aria-labelledby="editor-heading">
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>MARKDOWN</p><h2 id="editor-heading">本文を書く</h2></div>
            <div className="studio-editor__status">
              <span>{body.length.toLocaleString("ja-JP")}文字</span>
              {blockingErrorCount > 0 && (
                <button type="button" onClick={showValidation} aria-controls="article-validation">
                  書き出しエラー{blockingErrorCount}件を確認
                </button>
              )}
            </div>
          </div>
          <label className="sr-only" htmlFor="article-body">Markdown本文</label>
          <p id="article-body-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {bodyErrors.length > 0
              ? `本文に書き出しを止めるエラーが${bodyErrors.length}件あります。`
              : "本文に書き出しを止めるエラーはありません。"}
          </p>
          <textarea
            ref={bodyInput}
            id="article-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            spellCheck="true"
            aria-invalid={bodyErrors.length > 0}
            aria-errormessage={bodyErrors.length > 0 ? "article-body-status" : undefined}
          />
        </section>

        <section className={`studio-preview ${activePane === "preview" ? "is-active" : ""}`} aria-labelledby="preview-heading">
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>PREVIEW</p><h2 id="preview-heading">表示を確認</h2></div>
            <span className="studio-preview__status">自動更新</span>
          </div>
          <article>
            {frontmatter.heroImage && <img className="studio-preview__hero-image" src={frontmatter.heroImage.src} alt={frontmatter.heroImage.alt} />}
            <div className="studio-preview__meta">
              <span>{topicLabels[frontmatter.topics[0] as keyof typeof topicLabels] ?? frontmatter.topics[0]}</span>
              <span>約{frontmatter.estimatedMinutes}分</span>
              <span>{frontmatter.authors.join("、")}</span>
            </div>
            <h1>{frontmatter.title || "タイトル未入力"}</h1>
            <p className="studio-preview__lead">{frontmatter.description}</p>
            <div className="studio-preview__body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </article>
        </section>
      </main>
    </div>
  );
}
