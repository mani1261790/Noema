import { useDeferredValue, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {
  articleFrontmatterSchema,
  previewArticleMarkdown,
  previewArticles,
  serializeArticle,
  stageLabels,
  topicLabels,
  trackLabels,
  type ArticleFrontmatter
} from "@noema/content";

type Pane = "settings" | "write" | "preview";

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:4321";
const initialArticle: ArticleFrontmatter = {
  ...previewArticles[0],
  status: "draft",
  authors: ["Noema編集部"]
};

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
  const [frontmatter, setFrontmatter] = useState<ArticleFrontmatter>(initialArticle);
  const [body, setBody] = useState(previewArticleMarkdown.trim());
  const [activePane, setActivePane] = useState<Pane>("write");
  const deferredBody = useDeferredValue(body);
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(markdown.render(deferredBody)),
    [deferredBody]
  );
  const validation = articleFrontmatterSchema.safeParse(frontmatter);
  const warnings = [
    ...(body.trim().length < 200 ? ["本文が短いため、公開前に内容を確認してください。"] : []),
    ...(/^#\s/m.test(body) ? ["本文のH1見出しは削除してください。記事タイトルがH1になります。"] : []),
    ...(frontmatter.sources.length === 0 ? ["出典がまだ登録されていません。"] : [])
  ];

  const update = <K extends keyof ArticleFrontmatter>(key: K, value: ArticleFrontmatter[K]) => {
    setFrontmatter((current) => ({ ...current, [key]: value }));
  };

  const updateStage = (stage: ArticleFrontmatter["stage"]) => {
    setFrontmatter((current) => ({
      ...current,
      stage,
      track: stage === "advanced" ? (current.track === "common" ? "development" : current.track) : "common"
    }));
  };

  const download = () => {
    const result = articleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) return;
    const blob = new Blob([serializeArticle(result.data, body)], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${frontmatter.slug}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand__mark" aria-hidden="true">N</span>
          <span>Noema <strong>Studio</strong></span>
        </div>
        <div className="studio-header__actions">
          <a className="dads-button" data-size="md" data-type="outline" href={publicSiteUrl} target="_blank" rel="noreferrer">
            公開サイトを確認 <Icon name="external" />
          </a>
          <button className="dads-button" data-size="md" data-type="solid-fill" type="button" onClick={download} disabled={!validation.success}>
            Markdownを書き出す <Icon name="download" />
          </button>
        </div>
      </header>

      <nav className="studio-tabs" aria-label="編集画面">
        {(["settings", "write", "preview"] as Pane[]).map((pane) => (
          <button key={pane} type="button" aria-current={activePane === pane ? "page" : undefined} onClick={() => setActivePane(pane)}>
            {{ settings: "設定", write: "本文", preview: "プレビュー" }[pane]}
          </button>
        ))}
      </nav>

      <main className="studio-workspace">
        <aside className={`studio-settings ${activePane === "settings" ? "is-active" : ""}`} aria-label="記事設定">
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
          <div className="studio-field-row">
            <Field id="article-stage" label="学習段階">
              <select id="article-stage" value={frontmatter.stage} onChange={(event) => updateStage(event.target.value as ArticleFrontmatter["stage"])}>
                <option value="experience">{stageLabels.experience}</option>
                <option value="practice">{stageLabels.practice}</option>
                <option value="advanced">{stageLabels.advanced}</option>
              </select>
            </Field>
            <Field id="article-minutes" label="読了時間">
              <input id="article-minutes" className="dads-input-text" type="number" min="1" max="180" value={frontmatter.estimatedMinutes} onChange={(event) => update("estimatedMinutes", Number(event.target.value))} />
            </Field>
          </div>
          <Field id="article-track" label="発展トラック" hint="Level 1・2では共通、発展では開発か理論を選びます">
            <select
              id="article-track"
              value={frontmatter.track}
              disabled={frontmatter.stage !== "advanced"}
              onChange={(event) => update("track", event.target.value as ArticleFrontmatter["track"])}
            >
              {frontmatter.stage !== "advanced" && <option value="common">{trackLabels.common}</option>}
              <option value="development">{trackLabels.development}</option>
              <option value="theory">{trackLabels.theory}</option>
            </select>
          </Field>
          <Field id="article-topic" label="トピック">
            <select id="article-topic" value={frontmatter.topics[0]} onChange={(event) => update("topics", [event.target.value])}>
              {Object.entries(topicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field id="article-tags" label="タグ" hint="カンマ区切り">
            <input id="article-tags" className="dads-input-text" value={frontmatter.tags.join(", ")} onChange={(event) => update("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} />
          </Field>
          <Field id="article-prerequisites" label="前提知識" hint="不要な場合は空欄、複数ある場合はカンマ区切り">
            <input id="article-prerequisites" className="dads-input-text" value={frontmatter.prerequisites.join(", ")} onChange={(event) => update("prerequisites", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
          </Field>

          <section className="studio-validation" aria-live="polite">
            <h2>{validation.success ? <Icon name="check" /> : <Icon name="warning" />} 公開前チェック</h2>
            {!validation.success ? validation.error.issues.slice(0, 3).map((issue) => <p key={issue.path.join(".")}>{issue.message}</p>) : null}
            {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            {validation.success && warnings.length === 0 ? <p>公開に必要な項目が揃っています。</p> : null}
          </section>
        </aside>

        <section className={`studio-editor ${activePane === "write" ? "is-active" : ""}`} aria-labelledby="editor-heading">
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>MARKDOWN</p><h2 id="editor-heading">本文を書く</h2></div>
            <span>{body.length.toLocaleString("ja-JP")}文字</span>
          </div>
          <label className="sr-only" htmlFor="article-body">Markdown本文</label>
          <textarea id="article-body" value={body} onChange={(event) => setBody(event.target.value)} spellCheck="true" />
        </section>

        <section className={`studio-preview ${activePane === "preview" ? "is-active" : ""}`} aria-labelledby="preview-heading">
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>PREVIEW</p><h2 id="preview-heading">表示を確認</h2></div>
            <span className="studio-preview__status">自動更新</span>
          </div>
          <article>
            <div className="studio-preview__meta">
              <span>{stageLabels[frontmatter.stage]}</span>
              {frontmatter.track !== "common" && <span>{trackLabels[frontmatter.track]}</span>}
              <span>{topicLabels[frontmatter.topics[0] as keyof typeof topicLabels] ?? frontmatter.topics[0]}</span>
              <span>約{frontmatter.estimatedMinutes}分</span>
            </div>
            <h1>{frontmatter.title || "タイトル未入力"}</h1>
            <p className="studio-preview__lead">{frontmatter.description}</p>
            <section className="studio-preview__outcome">
              <strong>この記事でできるようになること</strong>
              <p>{frontmatter.outcome || "未入力"}</p>
            </section>
            <div className="studio-preview__body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </article>
        </section>
      </main>
    </div>
  );
}
