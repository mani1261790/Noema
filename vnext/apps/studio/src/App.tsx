import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import DOMPurify from "dompurify";
import {
  articleFrontmatterSchema,
  approachLabels,
  isSafeHttpUrl,
  parseArticle,
  serializeArticle,
  topicLabels,
  validateArticleMarkdown,
  type ArticleFrontmatter,
  type ArticleMarkdownIssue
} from "@noema/content";
import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsRoleLabels,
  cmsVisibilityLabels,
  validateCmsArticleForReview,
  type CmsArticleAction,
  type CmsArticleDetail,
  type CmsArticleSummary,
  type CmsAsset,
  type CmsAssetStatus,
  type CmsEditorialIssue,
  type CmsMember,
  type CmsRole,
  type CmsSession,
  type CmsVisibility
} from "@noema/cms";
import {
  createCmsArticle as createCmsArticleRecord,
  fetchCmsArticle,
  fetchCmsArticles,
  fetchCmsAssets,
  fetchCmsMembers,
  fetchCmsSession,
  runCmsArticleAction,
  updateCmsArticle as updateCmsArticleRecord,
  updateCmsAsset as updateCmsAssetRecord,
  uploadCmsAsset,
  upsertCmsMember,
  type CmsClientError
} from "./cms-client";
import {
  clearDraft,
  createBlankArticle,
  hasMeaningfulArticleInput,
  loadDraft,
  resolveBrowserStorage,
  saveDraft,
  type DraftStorage,
  type StudioDraftCmsArticle
} from "./draft-storage";
import { createPreviewMarkdown, resolvePublicSiteReference } from "./preview-markdown";
import {
  MAX_ARTICLE_TOPICS,
  isArticleTopicChoiceDisabled,
  toggleArticleTopic
} from "./topic-selection";
import { resolveCmsRecoveryState } from "./cms-recovery";
import {
  CmsArticleLibrary,
  type CmsLibraryConnection
} from "./CmsArticleLibrary";
import type { CmsArticleFilter } from "./article-library";
import { suggestArticleMetadata } from "./article-autofill";
import { CmsAssetLibrary } from "./CmsAssetLibrary";
import { CmsAssetPicker } from "./CmsAssetPicker";

type StudioView = "articles" | "assets" | "editor";
type StudioSettingsMode = "metadata" | "workflow";
type OperationMessage = { text: string; tone: "error" | "info" | "success" };
type CmsSessionState =
  | { kind: "checking" }
  | { kind: "ready"; session: CmsSession }
  | { error: CmsClientError; kind: "unavailable" };
type CmsSaveState = "local" | "dirty" | "saving" | "saved" | "conflict" | "error";

const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:4321";
const markdown = createPreviewMarkdown(publicSiteUrl);
const autoManagedMetadataFields = new Set<keyof ArticleFrontmatter>([
  "approach",
  "description",
  "estimatedMinutes",
  "outcome",
  "slug",
  "tags",
  "title",
  "topics"
]);

const cmsVisibilityDescriptions: Record<CmsVisibility, string> = {
  public: "一覧と記事URLから誰でも読めます。",
  unlisted: "一覧には出さず、記事URLを知っている人だけが読めます。",
  restricted: "読者認証の準備中です。現在は公開できません。",
  internal: "Studioの運営メンバーだけが扱う原稿です。"
};

function cmsContentFingerprint(
  frontmatter: ArticleFrontmatter,
  body: string,
  visibility: CmsVisibility
): string {
  return JSON.stringify({ body, frontmatter, visibility });
}

const issueFieldIds: Record<string, string> = {
  approach: "article-approach",
  authors: "article-authors",
  description: "article-description",
  estimatedMinutes: "article-minutes",
  heroImage: "article-hero-image",
  outcome: "article-outcome",
  prerequisites: "article-prerequisites",
  publishedAt: "article-published-at",
  slug: "article-slug",
  sources: "article-sources",
  status: "article-status",
  tags: "article-tags",
  title: "article-title",
  topics: "article-topic",
  updatedAt: "article-updated-at"
};

const issueFieldLabels: Record<string, string> = {
  approach: "記事タイプ",
  authors: "執筆者",
  description: "概要",
  estimatedMinutes: "読了時間",
  heroImage: "記事画像",
  markdown: "本文",
  outcome: "読後の到達点",
  prerequisites: "前提知識",
  publishedAt: "公開日",
  slug: "スラッグ",
  sources: "参考資料",
  status: "公開状態",
  tags: "タグ",
  title: "タイトル",
  topics: "テーマ",
  updatedAt: "更新日"
};

function issueControlId(issue: CmsEditorialIssue): string | null {
  const path = normalizedIssuePath(issue);
  if (path[0] === "heroImage" && path[1] === "alt") return "article-hero-image-alt";
  if (path[0] === "sources" && typeof path[1] === "number") {
    const sourceField = path[2] === "title"
      ? "title"
      : path[2] === "url"
        ? "url"
        : path[2] === "checkedAt"
          ? "date"
          : null;
    if (sourceField) return `article-source-${sourceField}-${path[1]}`;
  }
  return typeof path[0] === "string" ? issueFieldIds[path[0]] ?? null : null;
}

interface InitialState {
  body: string;
  cmsAssociationRequired: boolean;
  cmsReference: StudioDraftCmsArticle | null;
  frontmatter: ArticleFrontmatter;
  hasRecoveryDraft: boolean;
  message: OperationMessage | null;
  saveStatus: string;
  storage: DraftStorage;
}

function getInitialState(): InitialState {
  const { available: storageAvailable, storage } = resolveBrowserStorage(window);

  const loadedDraft = loadDraft(storage);
  if (loadedDraft.status === "restored") {
    const cmsReference = loadedDraft.draft.cmsArticle ?? null;
    const meaningfulDraft = hasMeaningfulArticleInput(
      loadedDraft.draft.frontmatter,
      loadedDraft.draft.body
    );
    const cmsAssociationRequired = loadedDraft.draft.cmsAssociation === "unknown" && meaningfulDraft;
    const hasRecoveryDraft = !cmsReference && meaningfulDraft;
    return {
      body: loadedDraft.draft.body,
      cmsAssociationRequired,
      cmsReference,
      frontmatter: loadedDraft.draft.frontmatter,
      hasRecoveryDraft,
      message: cmsReference
          ? {
              text: "前回編集中だったCMS記事へ再接続しています。入力内容は復旧コピーから保持しています。",
              tone: "info"
            }
          : hasRecoveryDraft
            ? {
              text: cmsAssociationRequired
                ? "旧Studioの復旧原稿です。元のCMS記事を選ぶか、新しい記事として続けるかを確認してください。"
                : "このブラウザに保存した下書きを復元しました。",
              tone: cmsAssociationRequired ? "info" : "success"
            }
            : null,
      saveStatus: cmsReference
        ? "CMS記事へ再接続中…"
        : cmsAssociationRequired
          ? "元の記事を確認してください"
        : hasRecoveryDraft
          ? "保存した下書きを復元しました"
          : "下書きはこのブラウザに自動保存されます",
      storage
    };
  }

  return {
    body: "",
    cmsAssociationRequired: false,
    cmsReference: null,
    frontmatter: createBlankArticle(),
    hasRecoveryDraft: false,
    message: !storageAvailable
      ? {
          text: "このブラウザでは自動保存を利用できません。入力後はMarkdownを書き出して保管してください。",
          tone: "error"
        }
      : loadedDraft.status === "invalid"
      ? {
          text: "保存した下書きを安全に読み込めなかったため、新しい記事を開きました。",
          tone: "error"
        }
      : null,
    saveStatus: storageAvailable
      ? "下書きはこのブラウザに自動保存されます"
      : "自動保存を利用できません",
    storage
  };
}

function normalizedIssuePath(issue: CmsEditorialIssue): Array<string | number> {
  return issue.path[0] === "frontmatter" ? issue.path.slice(1) : issue.path;
}

function normalizedIssueField(issue: CmsEditorialIssue): string | null {
  const path = normalizedIssuePath(issue);
  return typeof path[0] === "string" ? path[0] : null;
}

function japaneseIssueMessage(issue: CmsEditorialIssue): string {
  const path = normalizedIssuePath(issue);
  const field = typeof path[0] === "string" ? path[0] : "";
  let label = issueFieldLabels[field] ?? "入力内容";
  if (field === "sources" && path[2] === "title") label = "参考資料の名前";
  if (field === "sources" && path[2] === "url") label = "参考資料のURL";
  if (field === "sources" && path[2] === "checkedAt") label = "参考資料の確認日";
  if (field === "heroImage" && path[1] === "alt") label = "画像の代替テキスト";
  if (field === "heroImage" && path[1] === "src") label = "画像パス";
  const message = issue.message;
  const listFields = new Set(["authors", "prerequisites", "sources", "tags", "topics"]);
  const listConstraint = listFields.has(field) && (path.length === 1 || /expected array/i.test(message));

  if (field === "estimatedMinutes" && /too small|greater than or equal/i.test(message)) {
    return "読了時間は1分以上で入力してください。";
  }
  if (field === "estimatedMinutes" && /too big|less than or equal/i.test(message)) {
    return "読了時間は180分以内で入力してください。";
  }
  if (listConstraint && /too small|must contain at least/i.test(message)) {
    return `${label}を1件以上入力してください。`;
  }
  if (listConstraint && /too big|must contain at most|maximum/i.test(message)) {
    return `${label}の件数を減らしてください。`;
  }

  if (/too small|expected string to have >=?\s*1|must contain at least 1/i.test(message)) {
    return `${label}を入力してください。`;
  }
  if (/too big|must contain at most|maximum/i.test(message)) {
    return `${label}が長すぎます。文字数を減らしてください。`;
  }
  if (/invalid iso date|invalid date/i.test(message)) {
    return `${label}を正しい日付で入力してください。`;
  }
  if (/invalid url|invalid uri/i.test(message)) {
    return `${label}を正しいURLで入力してください。`;
  }
  if (/invalid input|invalid string|expected (string|number|array|object)/i.test(message)) {
    return `${label}の入力内容を確認してください。`;
  }
  return message.replace(/^Markdown本文/u, "本文").replace(/^slug/u, "スラッグ");
}

function normalizeReviewIssues(
  issues: CmsEditorialIssue[]
): CmsEditorialIssue[] {
  const unique = new Map<string, CmsEditorialIssue>();
  for (const issue of issues) {
    const normalized = { ...issue, message: japaneseIssueMessage(issue) };
    const key = `${normalized.path.join(".")}|${normalized.message}`;
    if (!unique.has(key)) unique.set(key, normalized);
  }
  const normalizedIssues = [...unique.values()];
  const missingPaths = new Set(
    normalizedIssues
      .filter((issue) => /を入力してください。?$/u.test(issue.message))
      .map((issue) => issue.path.join("."))
  );
  return normalizedIssues.filter((issue) => {
    const path = issue.path.join(".");
    return !missingPaths.has(path) || /を入力してください。?$/u.test(issue.message);
  });
}

function fieldError(
  issues: CmsEditorialIssue[],
  field: string,
  visible: boolean,
  child?: string
): string | undefined {
  if (!visible) return undefined;
  return issues.find((issue) => {
    const path = normalizedIssuePath(issue);
    return path[0] === field && (child === undefined || path.length === 1 || path.slice(1).includes(child));
  })?.message;
}

function sourceFieldError(
  issues: CmsEditorialIssue[],
  index: number,
  key: "checkedAt" | "title" | "url",
  visible: boolean
): string | undefined {
  if (!visible) return undefined;
  return issues.find((issue) => {
    const path = normalizedIssuePath(issue);
    return path[0] === "sources" && path[1] === index && path[2] === key;
  })?.message;
}

function Field({
  children,
  counter,
  error,
  id,
  label,
  required = true,
  support
}: {
  children: ReactNode;
  counter?: string;
  error?: string;
  id: string;
  label: string;
  required?: boolean;
  support?: string;
}) {
  return (
    <div className={`studio-field ${error ? "has-error" : ""}`}>
      <label className="dads-form-control-label studio-field__label" htmlFor={id}>
        <span>{label}</span>
        <span className="studio-field__requirement">※{required ? "必須" : "任意"}</span>
      </label>
      {support ? <p className="studio-field__support" id={`${id}-support`}>{support}</p> : null}
      {children}
      {error ? <p className="studio-field__error" id={`${id}-error`}>エラー — {error}</p> : null}
      {counter ? <p className="studio-field__counter" id={`${id}-counter`}>{counter}</p> : null}
    </div>
  );
}

function inputA11y(
  id: string,
  support: boolean,
  error?: string,
  counter = false,
  required = true
) {
  const describedBy = [
    support ? `${id}-support` : null,
    error ? `${id}-error` : null,
    counter ? `${id}-counter` : null
  ]
    .filter(Boolean)
    .join(" ");
  return {
    "aria-describedby": describedBy || undefined,
    "aria-errormessage": error ? `${id}-error` : undefined,
    "aria-invalid": error ? true : undefined,
    "aria-required": required
  };
}

function Icon({ name }: { name: "check" | "download" | "external" | "warning" }) {
  const paths = {
    check: <path d="m5 12 4 4L19 6" />,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 18v3h14v-3" /></>,
    external: <><path d="M14 4h6v6m0-6-9 9" /><path d="M18 13v7H4V6h7" /></>,
    warning: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3v1" /></>
  };
  return <svg className="studio-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function formatArticleDate(value?: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value;
}

function PreviewHeroImage({ image }: { image: NonNullable<ArticleFrontmatter["heroImage"]> }) {
  const [failed, setFailed] = useState(false);
  const src = resolvePublicSiteReference(image.src, publicSiteUrl);

  if (failed) {
    return (
      <div className="studio-preview__hero-error">
        <Icon name="warning" />
        <p role="status"><strong>記事画像を表示できません。</strong> パスを確認してください。</p>
        <code>{image.src}</code>
        <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => setFailed(false)}>
          再読み込み
        </button>
      </div>
    );
  }

  return <img className="studio-preview__hero-image" src={src} alt={image.alt} onError={() => setFailed(true)} />;
}

function ArticlePreviewContent({
  frontmatter,
  previewHtml
}: {
  frontmatter: ArticleFrontmatter;
  previewHtml: string;
}) {
  return (
    <article>
      {frontmatter.heroImage ? <PreviewHeroImage key={frontmatter.heroImage.src} image={frontmatter.heroImage} /> : null}
      <div className="studio-preview__meta">
        <span>{topicLabels[frontmatter.topics[0] as keyof typeof topicLabels] ?? "テーマ未選択"}</span>
        <span>{approachLabels[frontmatter.approach]}</span>
        <span>約{frontmatter.estimatedMinutes || "—"}分</span>
        <span>{frontmatter.authors.filter(Boolean).join("、") || "執筆者未入力"}</span>
      </div>
      <h1>{frontmatter.title || "タイトル未入力"}</h1>
      <p className="studio-preview__lead">{frontmatter.description || "概要を入力すると、ここに表示されます。"}</p>
      {frontmatter.outcome ? (
        <section className="studio-preview__outcome">
          <h2>この記事でできるようになること</h2>
          <p>{frontmatter.outcome}</p>
        </section>
      ) : null}
      <div className="studio-preview__dates">
        {formatArticleDate(frontmatter.publishedAt) ? <span>公開 {formatArticleDate(frontmatter.publishedAt)}</span> : null}
        <span>更新 {formatArticleDate(frontmatter.updatedAt)}</span>
      </div>
      {frontmatter.tags.filter(Boolean).length > 0 ? (
        <ul className="studio-preview__tags" aria-label="タグ">
          {frontmatter.tags.filter(Boolean).map((tag) => <li key={tag}>{tag}</li>)}
        </ul>
      ) : null}
      <div className="studio-preview__body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      {frontmatter.sources.length > 0 ? (
        <section className="studio-preview__sources">
          <h2>参考資料</h2>
          <ul>{frontmatter.sources.map((source, index) => {
            const label = source.title || source.url || `資料 ${index + 1}`;
            return (
              <li key={`${source.url}-${index}`}>
                {isSafeHttpUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>}
                {source.checkedAt ? `（${formatArticleDate(source.checkedAt)}確認）` : ""}
              </li>
            );
          })}</ul>
        </section>
      ) : null}
    </article>
  );
}

function TagEditor({
  disabled,
  error,
  onChange,
  tags
}: {
  disabled?: boolean;
  error?: string;
  onChange: (tags: string[]) => void;
  tags: string[];
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#+/u, "");
    if (!nextTag) return;
    if (!tags.some((tag) => tag.toLocaleLowerCase() === nextTag.toLocaleLowerCase())) {
      onChange([...tags, nextTag]);
    }
    setInput("");
  };

  return (
    <div className={`studio-tag-editor ${error ? "has-error" : ""}`}>
      {tags.length > 0 ? (
        <ul className="studio-tag-editor__list" aria-label="設定済みのタグ">
          {tags.map((tag) => (
            <li key={tag}>
              <span>{tag}</span>
              <button
                aria-label={`${tag}を削除`}
                disabled={disabled}
                onClick={() => onChange(tags.filter((current) => current !== tag))}
                type="button"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="studio-tag-editor__empty">タグはまだありません。</p>}
      <div className="studio-tag-editor__input-row">
        <input
          aria-describedby="article-tags-support"
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          id="article-tags"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="タグを入力"
          value={input}
        />
        <button className="dads-button" data-size="sm" data-type="outline" disabled={disabled || !input.trim()} onClick={addTag} type="button">追加</button>
      </div>
    </div>
  );
}


export function App() {
  const [initialState] = useState(getInitialState);
  const storage = initialState.storage;
  const [frontmatter, setFrontmatter] = useState<ArticleFrontmatter>({
    ...initialState.frontmatter,
    status: "draft"
  });
  const [body, setBody] = useState(initialState.body);
  const [studioView, setStudioView] = useState<StudioView>(
    initialState.cmsReference || initialState.hasRecoveryDraft
      ? "editor"
      : "articles"
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<StudioSettingsMode>("metadata");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState(initialState.saveStatus);
  const [operationMessage, setOperationMessage] = useState<OperationMessage | null>(initialState.message);
  const [validationRequested, setValidationRequested] = useState(false);
  const [publicationIssues, setPublicationIssues] = useState<CmsEditorialIssue[]>([]);
  const [cmsSessionState, setCmsSessionState] = useState<CmsSessionState>({ kind: "checking" });
  const [cmsRefresh, setCmsRefresh] = useState(0);
  const [cmsArticles, setCmsArticles] = useState<CmsArticleSummary[]>([]);
  const [cmsAssets, setCmsAssets] = useState<CmsAsset[]>([]);
  const [cmsAssetsError, setCmsAssetsError] = useState<CmsClientError | null>(null);
  const [cmsArticleQuery, setCmsArticleQuery] = useState("");
  const [cmsArticleFilter, setCmsArticleFilter] = useState<CmsArticleFilter>("all");
  const [cmsArticle, setCmsArticle] = useState<CmsArticleDetail | null>(null);
  const [cmsRecoveryReference, setCmsRecoveryReference] = useState<StudioDraftCmsArticle | null>(
    initialState.cmsReference
  );
  const [cmsAssociationRequired, setCmsAssociationRequired] = useState(
    initialState.cmsAssociationRequired
  );
  const [cmsAutosavePaused, setCmsAutosavePaused] = useState(
    Boolean(initialState.cmsReference?.autosavePaused)
  );
  const [openingArticleId, setOpeningArticleId] = useState<string | null>(null);
  const [hasRecoveryDraft, setHasRecoveryDraft] = useState(initialState.hasRecoveryDraft);
  const [cmsVisibility, setCmsVisibility] = useState<CmsVisibility>(
    initialState.cmsReference?.visibility ?? "public"
  );
  const [cmsSaveState, setCmsSaveState] = useState<CmsSaveState>(
    initialState.cmsReference ? "saving" : "local"
  );
  const [cmsConflict, setCmsConflict] = useState(false);
  const [cmsOperationBusy, setCmsOperationBusy] = useState(false);
  const [lastCmsFingerprint, setLastCmsFingerprint] = useState<string | null>(null);
  const [cmsMembers, setCmsMembers] = useState<CmsMember[]>([]);
  const [cmsMembersBusy, setCmsMembersBusy] = useState(false);
  const [cmsMembersError, setCmsMembersError] = useState<string | null>(null);
  const [cmsMemberEmail, setCmsMemberEmail] = useState("");
  const [cmsMemberRole, setCmsMemberRole] = useState<CmsRole>("editor");
  const [cmsMemberActive, setCmsMemberActive] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<"body" | "hero" | null>(null);
  const [assetOperationBusy, setAssetOperationBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const validationSection = useRef<HTMLElement>(null);
  const cmsRecoveryReconnectInFlight = useRef<string | null>(null);
  const cmsSaveInFlight = useRef(false);
  const pendingViewFocus = useRef<string | null>(null);
  const cmsContentRef = useRef({ body, frontmatter, visibility: cmsVisibility });
  const manuallyEditedMetadata = useRef<Set<keyof ArticleFrontmatter>>(
    new Set(
      initialState.cmsReference || initialState.hasRecoveryDraft
        ? autoManagedMetadataFields
        : []
    )
  );
  const deferredBody = useDeferredValue(body);
  cmsContentRef.current = { body, frontmatter, visibility: cmsVisibility };

  const cmsDraftReference = useMemo<StudioDraftCmsArticle | null>(() => {
    const reference = cmsRecoveryReference ?? (cmsArticle
      ? { id: cmsArticle.id, lockVersion: cmsArticle.lockVersion }
      : null);
    return reference
      ? {
          ...reference,
          visibility: cmsVisibility,
          ...(cmsAutosavePaused ? { autosavePaused: true as const } : {})
        }
      : null;
  }, [cmsArticle, cmsAutosavePaused, cmsRecoveryReference, cmsVisibility]);

  const saveBrowserDraft = useCallback((draftFrontmatter: ArticleFrontmatter, draftBody: string) => (
    saveDraft(storage, {
      frontmatter: draftFrontmatter,
      body: draftBody,
      ...(cmsDraftReference ? { cmsArticle: cmsDraftReference } : {}),
      ...(cmsAssociationRequired && !cmsDraftReference ? { cmsAssociation: "unknown" as const } : {})
    })
  ), [cmsAssociationRequired, cmsDraftReference, storage]);

  const previewHtml = useMemo(
    () => DOMPurify.sanitize(markdown.render(deferredBody), { ADD_ATTR: ["target"] }),
    [deferredBody]
  );
  const bodyIssues = useMemo(() => validateArticleMarkdown(deferredBody), [deferredBody]);
  const bodyErrors = bodyIssues.filter((issue) => issue.severity === "error");
  const reviewValidation = useMemo(
    () => validateCmsArticleForReview({ frontmatter, markdown: deferredBody }),
    [deferredBody, frontmatter]
  );
  const localReviewIssues = useMemo<CmsEditorialIssue[]>(
    () => normalizeReviewIssues(reviewValidation),
    [reviewValidation]
  );
  const visibleReviewIssues = publicationIssues.length > 0 ? publicationIssues : localReviewIssues;
  const blockingErrorCount = visibleReviewIssues.length;
  const settingsErrorCount = visibleReviewIssues.filter((issue) => normalizedIssueField(issue) !== "markdown").length;
  const visibleSettingsIssues = visibleReviewIssues.filter((issue) => normalizedIssueField(issue) !== "markdown");
  const bodyReviewIssue = visibleReviewIssues.find((issue) => normalizedIssueField(issue) === "markdown");
  const bodyErrorMessage = bodyReviewIssue?.message ?? bodyErrors[0]?.message;
  const bodyInvalid = (validationRequested || publicationIssues.length > 0) && Boolean(bodyErrorMessage);
  const editorialWarnings = [
    ...(frontmatter.sources.length === 0 ? ["出典がまだ登録されていません。"] : [])
  ];
  const editorLocked = false;
  const cmsFingerprint = useMemo(
    () => cmsContentFingerprint(frontmatter, body, cmsVisibility),
    [body, cmsVisibility, frontmatter]
  );
  const cmsDirty = cmsArticle !== null && cmsFingerprint !== lastCmsFingerprint;


  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setCmsSessionState({ kind: "checking" });
    setCmsAssetsError(null);
    void Promise.all([
      fetchCmsSession({ signal: controller.signal }),
      fetchCmsArticles({ signal: controller.signal }),
      fetchCmsAssets({ signal: controller.signal })
    ]).then(([sessionResult, articlesResult, assetsResult]) => {
      if (!current || controller.signal.aborted) return;
      if (!sessionResult.ok) {
        setCmsSessionState({ error: sessionResult.error, kind: "unavailable" });
        return;
      }
      if (!articlesResult.ok) {
        setCmsSessionState({ error: articlesResult.error, kind: "unavailable" });
        return;
      }
      setCmsSessionState({ kind: "ready", session: sessionResult.value });
      setCmsArticles(articlesResult.value);
      if (assetsResult.ok) setCmsAssets(assetsResult.value);
      else setCmsAssetsError(assetsResult.error);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [cmsRefresh]);

  useEffect(() => {
    if (cmsSessionState.kind !== "ready" || !cmsSessionState.session.capabilities.canManageMembers) {
      setCmsMembers([]);
      setCmsMembersBusy(false);
      setCmsMembersError(null);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setCmsMembersBusy(true);
    setCmsMembersError(null);
    void fetchCmsMembers({ signal: controller.signal }).then((result) => {
      if (!current || controller.signal.aborted) return;
      if (result.ok) setCmsMembers(result.value);
      else setCmsMembersError(result.error.message);
      setCmsMembersBusy(false);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [cmsRefresh, cmsSessionState]);

  useEffect(() => {
    const targetId = pendingViewFocus.current;
    if (!targetId) return;
    document.getElementById(targetId)?.focus();
    pendingViewFocus.current = null;
  }, [settingsOpen, studioView]);

  useEffect(() => {
    const meaningfulLocalInput = hasMeaningfulArticleInput(frontmatter, body);
    if (
      studioView !== "editor" ||
      editorLocked ||
      (!cmsArticle && !meaningfulLocalInput)
    ) return;
    setSaveStatus("復旧コピーを保存中…");
    const timer = window.setTimeout(() => {
      const result = saveBrowserDraft(frontmatter, body);
      setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
      if (result.ok && !cmsArticle && meaningfulLocalInput) setHasRecoveryDraft(true);
      if (!result.ok) {
        setOperationMessage({
          text: "ブラウザに復旧コピーを保存できませんでした。Markdownを書き出して内容を保管してください。",
          tone: "error"
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [body, cmsArticle, editorLocked, frontmatter, saveBrowserDraft, studioView]);

  useEffect(() => {
    if (!validationRequested) return;
    if (visibleReviewIssues.some((issue) => ["status", "authors", "publishedAt", "updatedAt", "approach", "estimatedMinutes", "topics", "tags", "prerequisites"].includes(normalizedIssueField(issue) ?? ""))) {
      setMetadataOpen(true);
    }
    if (visibleReviewIssues.some((issue) => normalizedIssueField(issue) === "heroImage")) setMediaOpen(true);
    if (visibleReviewIssues.some((issue) => normalizedIssueField(issue) === "sources")) setSourcesOpen(true);
  }, [validationRequested, visibleReviewIssues]);

  const update = <K extends keyof ArticleFrontmatter>(key: K, value: ArticleFrontmatter[K]) => {
    if (editorLocked) return;
    if (autoManagedMetadataFields.has(key)) manuallyEditedMetadata.current.add(key);
    setFrontmatter((current) => ({ ...current, [key]: value }));
    setPublicationIssues([]);
  };

  const applyAutomaticMetadata = useCallback((force = false) => {
    if (editorLocked || body.trim().length < 20) return;
    setFrontmatter((current) => {
      const suggestion = suggestArticleMetadata({
        body,
        currentTitle: manuallyEditedMetadata.current.has("title") ? current.title : "",
        updatedAt: current.updatedAt
      });
      const next = { ...current };
      const assign = <K extends keyof typeof suggestion>(key: K) => {
        if (force || !manuallyEditedMetadata.current.has(key)) {
          (next as Record<string, unknown>)[key] = suggestion[key];
        }
      };
      assign("title");
      assign("description");
      assign("slug");
      assign("topics");
      assign("tags");
      assign("approach");
      assign("outcome");
      assign("estimatedMinutes");
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [body, editorLocked]);

  useEffect(() => {
    if (studioView !== "editor") return;
    const timer = window.setTimeout(() => applyAutomaticMetadata(false), 700);
    return () => window.clearTimeout(timer);
  }, [applyAutomaticMetadata, deferredBody, studioView]);

  const updateCmsArticleList = useCallback((article: CmsArticleDetail) => {
    setCmsArticles((current) => [article, ...current.filter((item) => item.id !== article.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }, []);

  useEffect(() => {
    if (
      cmsSessionState.kind !== "ready" ||
      !cmsRecoveryReference ||
      cmsArticle ||
      cmsRecoveryReconnectInFlight.current === cmsRecoveryReference.id
    ) return;

    const controller = new AbortController();
    const reference = cmsRecoveryReference;
    let current = true;
    cmsRecoveryReconnectInFlight.current = reference.id;
    setCmsOperationBusy(true);
    void fetchCmsArticle(reference.id, { signal: controller.signal }).then((result) => {
      if (!current || controller.signal.aborted) return;
      if (!result.ok) {
        setCmsSaveState("error");
        setOperationMessage({
          text: "復旧コピーを元のCMS記事へ再接続できませんでした。内容は保持しています。もう一度確認するか、記事一覧から元の記事を開いてください。",
          tone: "error"
        });
        cmsRecoveryReconnectInFlight.current = null;
        setCmsOperationBusy(false);
        return;
      }

      const article = result.value;
      const latest = cmsContentRef.current;
      const recovery = resolveCmsRecoveryState({
        article,
        localBody: latest.body,
        localFrontmatter: latest.frontmatter,
        localVisibility: latest.visibility,
        reference
      });

      setCmsArticle(article);
      setLastCmsFingerprint(recovery.serverFingerprint);
      setCmsConflict(recovery.conflict);
      setCmsSaveState(recovery.saveState);
      const keepAutosavePaused = cmsAutosavePaused && recovery.saveState === "dirty";
      setCmsAutosavePaused(keepAutosavePaused);
      setHasRecoveryDraft(false);
      updateCmsArticleList(article);
      if (!recovery.conflict) setCmsRecoveryReference(null);
      saveDraft(storage, {
        frontmatter: latest.frontmatter,
        body: latest.body,
        cmsArticle: recovery.conflict
          ? {
              ...reference,
              visibility: latest.visibility,
              ...(keepAutosavePaused ? { autosavePaused: true as const } : {})
            }
          : {
              id: article.id,
              lockVersion: article.lockVersion,
              visibility: latest.visibility,
              ...(keepAutosavePaused ? { autosavePaused: true as const } : {})
            }
      });
      setOperationMessage({
        text: recovery.conflict
          ? "元の記事は別の編集者によって更新されています。入力内容は保持しました。"
          : keepAutosavePaused
            ? `「${article.title || "無題の記事"}」へ再接続しました。内容を確認し、「保存」でCMSへ反映してください。`
          : `「${article.title || "無題の記事"}」へ再接続しました。`,
        tone: recovery.conflict ? "error" : "success"
      });
      cmsRecoveryReconnectInFlight.current = null;
      setCmsOperationBusy(false);
    });

    return () => {
      current = false;
      controller.abort();
      if (cmsRecoveryReconnectInFlight.current === reference.id) {
        cmsRecoveryReconnectInFlight.current = null;
      }
    };
  }, [cmsArticle, cmsAutosavePaused, cmsRecoveryReference, cmsSessionState, storage, updateCmsArticleList]);

  const showEditor = () => {
    pendingViewFocus.current = "editor-heading";
    setStudioView("editor");
    setSettingsOpen(false);
    setPreviewFullscreen(false);
  };

  const showArticleLibrary = () => {
    setOperationMessage(null);
    if (hasMeaningfulArticleInput(frontmatter, body)) {
      const result = saveBrowserDraft(frontmatter, body);
      if (!cmsArticle && !cmsRecoveryReference) setHasRecoveryDraft(true);
      setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
      if (!result.ok) {
        setOperationMessage({
          text: "復旧コピーを保存できませんでした。内容はこの画面を閉じるまで保持しています。",
          tone: "error"
        });
      }
    }
    pendingViewFocus.current = "studio-article-library-heading";
    setStudioView("articles");
  };

  const showAssetLibrary = () => {
    setOperationMessage(null);
    if (hasMeaningfulArticleInput(frontmatter, body)) saveBrowserDraft(frontmatter, body);
    pendingViewFocus.current = "studio-asset-library-heading";
    setStudioView("assets");
    setSettingsOpen(false);
    setPreviewFullscreen(false);
  };

  const applyCmsArticle = (
    article: CmsArticleDetail,
    options: {
      pauseAutosave?: boolean;
      preserveLocalInput?: boolean;
      preserveLocalVisibility?: boolean;
    } = {}
  ) => {
    const nextFrontmatter: ArticleFrontmatter = {
      ...article.currentRevision.frontmatter,
      status: "draft"
    };
    const nextBody = article.currentRevision.markdown;
    const serverFingerprint = cmsContentFingerprint(nextFrontmatter, nextBody, article.visibility);
    const local = cmsContentRef.current;
    const preservedVisibility = options.preserveLocalVisibility
      ? local.visibility
      : article.visibility;
    const preservedInputHasChanges = Boolean(
      options.preserveLocalInput &&
      cmsContentFingerprint(local.frontmatter, local.body, preservedVisibility) !== serverFingerprint
    );
    const manualSaveRequired = Boolean(options.pauseAutosave && preservedInputHasChanges);
    setCmsArticle(article);
    setLastCmsFingerprint(serverFingerprint);
    setCmsSaveState(preservedInputHasChanges ? "dirty" : "saved");
    setCmsAutosavePaused(manualSaveRequired);
    setCmsConflict(false);
    setCmsRecoveryReference(null);
    setCmsAssociationRequired(false);
    setHasRecoveryDraft(false);
    setPublicationIssues([]);
    setValidationRequested(false);
    manuallyEditedMetadata.current = new Set(autoManagedMetadataFields);
    updateCmsArticleList(article);
    if (!options.preserveLocalInput) {
      setFrontmatter(nextFrontmatter);
      setBody(nextBody);
      setCmsVisibility(article.visibility);
      saveDraft(storage, {
        frontmatter: nextFrontmatter,
        body: nextBody,
        cmsArticle: {
          id: article.id,
          lockVersion: article.lockVersion,
          visibility: article.visibility
        }
      });
    } else {
      setCmsVisibility(preservedVisibility);
      setSaveStatus("ブラウザに復旧コピーを保存済み");
      saveDraft(storage, {
        frontmatter: local.frontmatter,
        body: local.body,
        cmsArticle: {
          id: article.id,
          lockVersion: article.lockVersion,
          visibility: preservedVisibility,
          ...(manualSaveRequired ? { autosavePaused: true as const } : {})
        }
      });
    }
    return { manualSaveRequired };
  };

  const loadCmsArticle = async (articleId: string): Promise<boolean> => {
    if (editorLocked || cmsOperationBusy || cmsSaveInFlight.current) return false;
    if (articleId === cmsArticle?.id) {
      showEditor();
      return true;
    }
    const hasLocalInput = hasMeaningfulArticleInput(frontmatter, body);
    const associatingRecovery = cmsAssociationRequired && !cmsArticle && hasLocalInput;
    const articleSummary = cmsArticles.find((article) => article.id === articleId);
    if (associatingRecovery && !window.confirm(
      `復旧原稿を「${articleSummary?.title || "選んだ記事"}」に引き継ぎますか？ CMSへはまだ保存せず、編集画面で内容を確認できます。`
    )) return false;
    if (!associatingRecovery && (cmsDirty || (!cmsArticle && hasLocalInput)) && !window.confirm(
      "現在の入力内容を別の記事で置き換えますか？ 必要なら先にMarkdownを書き出してください。"
    )) return false;
    const contentBeforeLoad = cmsContentFingerprint(
      cmsContentRef.current.frontmatter,
      cmsContentRef.current.body,
      cmsContentRef.current.visibility
    );
    setOpeningArticleId(articleId);
    setCmsOperationBusy(true);
    const result = await fetchCmsArticle(articleId);
    if (result.ok) {
      const latest = cmsContentRef.current;
      const contentAfterLoad = cmsContentFingerprint(latest.frontmatter, latest.body, latest.visibility);
      if (
        !associatingRecovery &&
        contentAfterLoad !== contentBeforeLoad &&
        !window.confirm("記事の読込中に入力が変わりました。新しい入力を破棄して、選んだ記事を開きますか？")
      ) {
        setCmsOperationBusy(false);
        setOpeningArticleId(null);
        return false;
      }
      const application = applyCmsArticle(result.value, {
        pauseAutosave: associatingRecovery,
        preserveLocalInput: associatingRecovery
      });
      showEditor();
      setOperationMessage({
        text: associatingRecovery
          ? application.manualSaveRequired
            ? `復旧原稿を「${result.value.title || "無題の記事"}」に引き継ぎました。内容を確認し、「保存」でCMSへ反映してください。`
            : `復旧原稿を「${result.value.title || "無題の記事"}」へ接続しました。CMSの最新版と同じ内容です。`
          : `「${result.value.title || "無題の記事"}」を読み込みました。`,
        tone: "success"
      });
    } else {
      setOperationMessage({ text: result.error.message, tone: "error" });
    }
    setCmsOperationBusy(false);
    setOpeningArticleId(null);
    return result.ok;
  };

  const saveCmsDraft = useCallback(async (announce = true): Promise<CmsArticleDetail | null> => {
    if (
      cmsSaveInFlight.current ||
      cmsConflict ||
      cmsRecoveryReference ||
      cmsAssociationRequired ||
      editorLocked ||
      cmsSessionState.kind !== "ready" ||
      !cmsSessionState.session.capabilities.canEdit
    ) return null;

    const snapshot = cmsContentRef.current;
    const draftFrontmatter: ArticleFrontmatter = {
      ...snapshot.frontmatter,
      status: "draft"
    };
    const snapshotFingerprint = cmsContentFingerprint(
      draftFrontmatter,
      snapshot.body,
      snapshot.visibility
    );
    cmsSaveInFlight.current = true;
    setCmsSaveState("saving");
    const result = cmsArticle
      ? await updateCmsArticleRecord(
          cmsArticle.id,
          cmsArticle.lockVersion,
          {
            frontmatter: draftFrontmatter,
            markdown: snapshot.body,
            visibility: snapshot.visibility
          }
        )
      : await createCmsArticleRecord({
          frontmatter: draftFrontmatter,
          markdown: snapshot.body,
          visibility: snapshot.visibility
        });

    cmsSaveInFlight.current = false;
    if (!result.ok) {
      if (result.error.code === "revision_conflict") {
        setCmsConflict(true);
        setCmsSaveState("conflict");
        setOperationMessage({
          text: "別の編集者がこの記事を更新しました。入力中の内容は保持しています。",
          tone: "error"
        });
      } else {
        setCmsSaveState("error");
        setOperationMessage({ text: result.error.message, tone: "error" });
      }
      return null;
    }

    setCmsArticle(result.value);
    setCmsRecoveryReference(null);
    setCmsAssociationRequired(false);
    setCmsAutosavePaused(false);
    setHasRecoveryDraft(false);
    updateCmsArticleList(result.value);
    setLastCmsFingerprint(snapshotFingerprint);
    const latest = cmsContentRef.current;
    saveDraft(storage, {
      frontmatter: latest.frontmatter,
      body: latest.body,
      cmsArticle: {
        id: result.value.id,
        lockVersion: result.value.lockVersion,
        visibility: latest.visibility
      }
    });
    const hasNewerLocalChanges = cmsContentFingerprint(
      latest.frontmatter,
      latest.body,
      latest.visibility
    ) !== snapshotFingerprint;
    setCmsSaveState(hasNewerLocalChanges ? "dirty" : "saved");
    if (announce) {
      setOperationMessage({
        text: cmsArticle
          ? `revision ${result.value.revisionNumber} をCMSへ保存しました。`
          : "新しい記事をCMSへ保存しました。",
        tone: "success"
      });
    }
    return result.value;
  }, [cmsArticle, cmsAssociationRequired, cmsConflict, cmsRecoveryReference, cmsSessionState, editorLocked, storage, updateCmsArticleList]);

  const continueRecoveryAsNewArticle = () => {
    setCmsAssociationRequired(false);
    setCmsAutosavePaused(false);
    const result = saveDraft(storage, { frontmatter, body });
    setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
    showEditor();
    setOperationMessage({
      text: result.ok
        ? "復旧原稿を新しい記事として扱います。内容を確認し、「CMSに保存」で登録してください。"
        : "新しい記事として続けますが、復旧コピーを保存できません。Markdownを書き出して保管してください。",
      tone: result.ok ? "info" : "error"
    });
  };

  const startNewCmsArticle = () => {
    if (editorLocked || cmsSaveInFlight.current) return;
    const hasLocalInput = hasMeaningfulArticleInput(frontmatter, body);
    if ((cmsDirty || (!cmsArticle && hasLocalInput)) && !window.confirm(
      "現在の入力内容を閉じて、新しい記事を開始しますか？ 必要なら先にCMSへ保存するかMarkdownを書き出してください。"
    )) return;
    const blank = createBlankArticle();
    clearDraft(storage);
    setCmsArticle(null);
    setCmsRecoveryReference(null);
    setCmsAssociationRequired(false);
    setCmsAutosavePaused(false);
    setHasRecoveryDraft(false);
    setFrontmatter(blank);
    setBody("");
    setCmsVisibility("public");
    setLastCmsFingerprint(null);
    setCmsSaveState("local");
    setCmsConflict(false);
    setPublicationIssues([]);
    setValidationRequested(false);
    manuallyEditedMetadata.current.clear();
    showEditor();
    setOperationMessage({ text: "新しい記事を作成します。最初の保存でCMSに登録されます。", tone: "info" });
  };

  const reloadLatestCmsArticle = async () => {
    if (!cmsArticle || cmsOperationBusy) return;
    if (!window.confirm(
      "入力中の内容を破棄してCMSの最新版を読み込みますか？ 必要なら先にMarkdownを書き出してください。"
    )) return;
    const contentBeforeReload = cmsContentFingerprint(
      cmsContentRef.current.frontmatter,
      cmsContentRef.current.body,
      cmsContentRef.current.visibility
    );
    setCmsOperationBusy(true);
    const result = await fetchCmsArticle(cmsArticle.id);
    if (result.ok) {
      const latest = cmsContentRef.current;
      const contentAfterReload = cmsContentFingerprint(latest.frontmatter, latest.body, latest.visibility);
      if (
        contentAfterReload !== contentBeforeReload &&
        !window.confirm("最新版の読込中に入力が変わりました。その変更も破棄してCMSの最新版を開きますか？")
      ) {
        setCmsOperationBusy(false);
        return;
      }
      applyCmsArticle(result.value);
      setOperationMessage({ text: "CMSの最新版を読み込みました。", tone: "success" });
    } else {
      setOperationMessage({ text: result.error.message, tone: "error" });
    }
    setCmsOperationBusy(false);
  };

  const runCmsAction = async (action: CmsArticleAction) => {
    if (cmsAutosavePaused) {
      setOperationMessage({
        text: "復旧内容を確認し、先に「保存」でCMSへ反映してください。保存後にレビュー・公開操作を続けられます。",
        tone: "info"
      });
      return;
    }
    if (
      cmsSessionState.kind !== "ready" ||
      cmsOperationBusy ||
      cmsSaveInFlight.current ||
      editorLocked
    ) return;
    let target = cmsArticle;
    if (!target || cmsDirty) target = await saveCmsDraft(false);
    if (!target) return;
    const latest = cmsContentRef.current;
    const latestFingerprint = cmsContentFingerprint(
      { ...latest.frontmatter, status: "draft" },
      latest.body,
      latest.visibility
    );
    const savedFingerprint = cmsContentFingerprint(
      { ...target.currentRevision.frontmatter, status: "draft" },
      target.currentRevision.markdown,
      target.visibility
    );
    if (latestFingerprint !== savedFingerprint) {
      setCmsSaveState("dirty");
      setOperationMessage({
        text: "保存中に新しい変更がありました。自動保存の完了後、もう一度ワークフロー操作を選んでください。",
        tone: "info"
      });
      return;
    }

    if (action === "request_review") {
      const validation = validateCmsArticleForReview({
        frontmatter: cmsContentRef.current.frontmatter,
        markdown: cmsContentRef.current.body
      });
      if (validation.length > 0) {
        setPublicationIssues(normalizeReviewIssues(validation));
        setValidationRequested(true);
        setOperationMessage({ text: "レビューへ送る前に入力エラーを確認してください。", tone: "error" });
        focusValidation();
        return;
      }
    }

    let note: string | undefined;
    if (action === "request_changes") {
      const response = window.prompt("修正してほしい内容を入力してください（任意・500文字まで）", target.reviewNote ?? "");
      if (response === null) return;
      note = response.trim().slice(0, 500) || undefined;
    }

    const actionStartFingerprint = latestFingerprint;
    setCmsOperationBusy(true);
    const result = await runCmsArticleAction(
      target.id,
      target.lockVersion,
      action,
      {
        ...(note ? { note } : {}),
        ...(action === "publish" ? { visibility: cmsVisibility } : {})
      }
    );
    if (result.ok) {
      const current = cmsContentRef.current;
      const localChangedDuringAction = cmsContentFingerprint(
        { ...current.frontmatter, status: "draft" },
        current.body,
        current.visibility
      ) !== actionStartFingerprint;
      applyCmsArticle(result.value, {
        preserveLocalInput: localChangedDuringAction,
        preserveLocalVisibility: localChangedDuringAction
      });
      const labels: Record<CmsArticleAction, string> = {
        approve: "記事を承認しました。",
        archive: "公開記事を保管しました。",
        publish: "承認済みrevisionを公開しました。",
        request_changes: "修正を依頼しました。",
        request_review: "レビューを依頼しました。",
        restore: "記事を未公開へ戻しました。"
      };
      setOperationMessage({
        text: localChangedDuringAction
          ? `${labels[action]} 操作中に入力した変更は未保存のまま保持しています。`
          : labels[action],
        tone: "success"
      });
    } else if (result.error.code === "revision_conflict") {
      setCmsConflict(true);
      setCmsSaveState("conflict");
      setOperationMessage({ text: "別の編集者が記事を更新しました。入力中の内容は保持しています。", tone: "error" });
    } else {
      if (result.error.issues) {
        setPublicationIssues(normalizeReviewIssues(result.error.issues));
        setValidationRequested(true);
      }
      setOperationMessage({ text: result.error.message, tone: "error" });
    }
    setCmsOperationBusy(false);
  };

  const saveCmsMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cmsSessionState.kind !== "ready" || !cmsSessionState.session.capabilities.canManageMembers) return;
    const email = cmsMemberEmail.trim().toLowerCase();
    if (!email) return;
    if (
      email === cmsSessionState.session.identity.email.toLowerCase() &&
      (!cmsMemberActive || cmsMemberRole !== cmsSessionState.session.identity.role)
    ) {
      setCmsMembersError("自分自身の役割変更・停止は、この画面からは行えません。別の管理者に依頼してください。");
      return;
    }
    setCmsMembersBusy(true);
    setCmsMembersError(null);
    const result = await upsertCmsMember({
      active: cmsMemberActive,
      email,
      role: cmsMemberRole
    });
    if (result.ok) {
      setCmsMembers(result.value);
      setCmsMemberEmail("");
      setCmsMemberRole("editor");
      setCmsMemberActive(true);
      setOperationMessage({ text: `${email} のCMS権限を更新しました。`, tone: "success" });
    } else {
      setCmsMembersError(result.error.message);
    }
    setCmsMembersBusy(false);
  };

  useEffect(() => {
    if (
      !cmsArticle ||
      !cmsDirty ||
      cmsConflict ||
      cmsAutosavePaused ||
      editorLocked ||
      cmsSaveState === "saving" ||
      cmsSaveState === "error" ||
      cmsSessionState.kind !== "ready" ||
      !cmsSessionState.session.capabilities.canEdit
    ) return;
    const timer = window.setTimeout(() => {
      void saveCmsDraft(false);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [
    cmsArticle,
    cmsAutosavePaused,
    cmsConflict,
    cmsDirty,
    cmsFingerprint,
    cmsSaveState,
    cmsSessionState,
    editorLocked,
    saveCmsDraft
  ]);

  const focusValidation = () => {
    setValidationRequested(true);
    setSettingsOpen(true);
    setPreviewFullscreen(false);
    window.requestAnimationFrame(() => {
      validationSection.current?.focus({ preventScroll: true });
      validationSection.current?.scrollIntoView({ block: "center" });
    });
  };

  const focusBodyIssue = (issue?: ArticleMarkdownIssue) => {
    setSettingsOpen(false);
    setPreviewFullscreen(false);
    window.requestAnimationFrame(() => {
      const input = bodyInput.current;
      if (!input) return;
      let start = 0;
      if (issue) {
        for (let line = 1; line < issue.line; line += 1) {
          const nextLine = body.indexOf("\n", start);
          if (nextLine < 0) break;
          start = nextLine + 1;
        }
      }
      const nextLine = body.indexOf("\n", start);
      input.focus();
      input.setSelectionRange(start, nextLine < 0 ? body.length : nextLine);
    });
  };

  const insertMarkdownAtCursor = (snippet: string) => {
    const input = bodyInput.current;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? start;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
    const inserted = `${prefix}${snippet}${suffix}`;
    setBody(`${before}${inserted}${after}`);
    setPublicationIssues([]);
    window.requestAnimationFrame(() => {
      const nextInput = bodyInput.current;
      if (!nextInput) return;
      const caret = start + inserted.length;
      nextInput.focus();
      nextInput.setSelectionRange(caret, caret);
    });
  };

  const uploadAssets = async (files: File[]) => {
    if (files.length === 0 || assetOperationBusy) return;
    setAssetOperationBusy(true);
    let uploaded = 0;
    for (const file of files) {
      const result = await uploadCmsAsset(file);
      if (!result.ok) {
        setOperationMessage({ text: `${file.name}: ${result.error.message}`, tone: "error" });
        setAssetOperationBusy(false);
        return;
      }
      uploaded += 1;
      setCmsAssets((current) => [result.value, ...current.filter((asset) => asset.id !== result.value.id)]);
    }
    setCmsAssetsError(null);
    setAssetOperationBusy(false);
    setOperationMessage({ text: `${uploaded}件の画像をAssetsへ追加しました。`, tone: "success" });
  };

  const saveAsset = async (
    asset: CmsAsset,
    input: { alt: string; status: CmsAssetStatus; tags: string[] }
  ) => {
    setAssetOperationBusy(true);
    const result = await updateCmsAssetRecord(asset.id, input);
    setAssetOperationBusy(false);
    if (!result.ok) {
      setOperationMessage({ text: result.error.message, tone: "error" });
      return;
    }
    setCmsAssets((current) => current.map((item) => item.id === result.value.id ? result.value : item));
    setOperationMessage({ text: "画像情報を保存しました。", tone: "success" });
  };

  const closeAssetPicker = () => {
    const target = assetPickerTarget;
    setAssetPickerTarget(null);
    window.requestAnimationFrame(() => {
      if (target === "hero") document.querySelector<HTMLElement>("#article-hero-asset")?.focus();
      else bodyInput.current?.focus();
    });
  };

  const insertAsset = (asset: CmsAsset, alt: string) => {
    const safeAlt = alt.replace(/[\[\]]/g, "");
    if (assetPickerTarget === "hero") {
      update("heroImage", { alt: safeAlt, src: asset.markdownUrl });
      setAssetPickerTarget(null);
      setMediaOpen(true);
      setOperationMessage({ text: "Assetsの画像を記事画像に設定しました。", tone: "success" });
      return;
    }
    setAssetPickerTarget(null);
    insertMarkdownAtCursor(`![${safeAlt}](${asset.markdownUrl})`);
    setOperationMessage({ text: "Assetsの画像を本文へ挿入しました。", tone: "success" });
  };

  const focusReviewIssue = (issue: CmsEditorialIssue) => {
    const field = normalizedIssueField(issue);
    if (field === "markdown") {
      focusBodyIssue(bodyIssues.find((bodyIssue) => bodyIssue.message === issue.message));
      return;
    }
    if (field === "heroImage") setMediaOpen(true);
    if (field === "sources") setSourcesOpen(true);
    if (["title", "description", "outcome", "slug"].includes(field ?? "")) setSummaryOpen(true);
    setSettingsOpen(true);
    setPreviewFullscreen(false);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(issueControlId(issue) ?? "");
      target?.focus();
      target?.scrollIntoView({ block: "center" });
    });
  };

  const download = () => {
    const result = articleFrontmatterSchema.safeParse(frontmatter);
    const currentBodyErrors = validateArticleMarkdown(body).filter((issue) => issue.severity === "error");
    if (!result.success || currentBodyErrors.length > 0) {
      setOperationMessage({ text: "書き出す前に入力エラーを確認してください。", tone: "error" });
      focusValidation();
      return;
    }
    const blob = new Blob([serializeArticle(result.data, body)], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${frontmatter.slug}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
    setOperationMessage({ text: `${frontmatter.slug}.mdを書き出しました。`, tone: "success" });
  };

  const downloadRecoveryCopy = () => {
    const safeSlug = frontmatter.slug.trim() || "noema-cms-recovery";
    const blob = new Blob([
      serializeArticle({ ...frontmatter, status: "draft" }, body)
    ], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeSlug}-recovery.md`;
    anchor.click();
    URL.revokeObjectURL(href);
    setOperationMessage({ text: "入力中の内容を復旧用Markdownとして書き出しました。", tone: "success" });
  };

  const importMarkdown = async (file?: File) => {
    if (!file || editorLocked) return;
    try {
      const parsed = await parseArticle(await file.text());
      const hasCurrentInput = body.length > 0 || JSON.stringify(frontmatter) !== JSON.stringify(createBlankArticle());
      if (hasCurrentInput && !window.confirm("現在の入力内容を、読み込んだMarkdownで置き換えますか？")) return;
      setFrontmatter({ ...parsed.frontmatter, status: "draft" });
      setBody(parsed.markdown);
      manuallyEditedMetadata.current = new Set(autoManagedMetadataFields);
      setValidationRequested(false);
      setPublicationIssues([]);
      setOperationMessage({ text: `${file.name}を読み込みました。`, tone: "success" });
    } catch (error) {
      setOperationMessage({
        text: error instanceof Error ? error.message : "Markdownを読み込めませんでした。",
        tone: "error"
      });
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };

  const updateSource = (index: number, key: "checkedAt" | "title" | "url", value: string) => {
    update("sources", frontmatter.sources.map((source, sourceIndex) =>
      sourceIndex === index ? { ...source, [key]: value } : source
    ));
  };

  const validationVisible = validationRequested || publicationIssues.length > 0;
  const cmsSession = cmsSessionState.kind === "ready" ? cmsSessionState.session : null;
  const cmsSaveLabel: Record<CmsSaveState, string> = {
    conflict: "保存競合・入力内容を保持中",
    dirty: "未保存の変更あり",
    error: "CMS保存に失敗",
    local: "新規原稿・未登録",
    saved: cmsArticle ? `CMS revision ${cmsArticle.revisionNumber} 保存済み` : "CMS保存済み",
    saving: "CMSへ保存中…"
  };
  const effectiveCmsSaveState: CmsSaveState = cmsDirty && cmsSaveState === "saved"
    ? "dirty"
    : cmsSaveState;
  const cmsWorkingArticleTitle = frontmatter.title || cmsArticle?.title || "編集中の記事";
  const cmsLibraryWorkingStatus: { text: string; tone: "error" | "info" } | null = cmsRecoveryReference
    ? {
        text: cmsConflict
          ? `「${cmsWorkingArticleTitle}」は別の編集者による更新と競合しています。入力内容はブラウザに保持しています。`
          : cmsSaveState === "error"
            ? `「${cmsWorkingArticleTitle}」を元のCMS記事へ再接続できません。入力内容はブラウザに保持しています。`
            : `「${cmsWorkingArticleTitle}」を元のCMS記事へ再接続しています。`,
        tone: cmsConflict || cmsSaveState === "error" ? "error" : "info"
      }
    : cmsArticle && ["dirty", "saving", "error", "conflict"].includes(effectiveCmsSaveState)
      ? {
          text: effectiveCmsSaveState === "dirty"
            ? cmsAutosavePaused
              ? `「${cmsWorkingArticleTitle}」に未保存の復旧内容があります。内容を確認し、編集画面の「保存」でCMSへ反映してください。`
              : `「${cmsWorkingArticleTitle}」に未保存の変更があります。CMSへの自動保存を待っています。`
            : effectiveCmsSaveState === "saving"
              ? `「${cmsWorkingArticleTitle}」をCMSへ保存しています。`
              : effectiveCmsSaveState === "conflict"
                ? `「${cmsWorkingArticleTitle}」は別の編集者による更新と競合しています。入力内容はブラウザに保持しています。`
                : `「${cmsWorkingArticleTitle}」をCMSへ保存できませんでした。入力内容はブラウザに保持しています。`,
          tone: ["error", "conflict"].includes(effectiveCmsSaveState) ? "error" : "info"
        }
      : null;
  const cmsCanRequestReview = Boolean(
    cmsArticle && ["draft", "changes_requested"].includes(cmsArticle.reviewStatus)
  );
  const cmsSelfApprovalBlocked = Boolean(
    cmsSession?.identity.role === "reviewer" &&
    cmsArticle?.currentRevision.createdByEmail.toLowerCase() === cmsSession.identity.email.toLowerCase()
  );
  const cmsCanReview = Boolean(
    cmsSession?.capabilities.canApprove &&
    cmsArticle?.reviewStatus === "in_review" &&
    !cmsSelfApprovalBlocked &&
    !cmsDirty
  );
  const cmsCanRequestChanges = Boolean(
    cmsSession?.capabilities.canApprove &&
    cmsArticle &&
    ["in_review", "approved"].includes(cmsArticle.reviewStatus) &&
    !cmsDirty
  );
  const cmsCanPublish = Boolean(
    cmsSession?.capabilities.canPublish &&
    cmsArticle?.reviewStatus === "approved" &&
    cmsArticle.publicationStatus !== "archived" &&
    !(
      cmsArticle.publicationStatus === "published" &&
      cmsArticle.publishedRevisionNumber === cmsArticle.revisionNumber
    ) &&
    ["public", "unlisted"].includes(cmsVisibility) &&
    !cmsDirty
  );
  const cmsLibraryConnection: CmsLibraryConnection = cmsSessionState.kind === "checking"
    ? { kind: "checking" }
    : cmsSessionState.kind === "unavailable"
      ? { kind: "unavailable", message: cmsSessionState.error.message }
      : {
          email: cmsSessionState.session.identity.email,
          kind: "ready",
          role: cmsSessionState.session.identity.role
        };
  const cmsAssetConnection: CmsLibraryConnection = cmsAssetsError
    ? { kind: "unavailable", message: cmsAssetsError.message }
    : cmsLibraryConnection;
  const cmsEditorStatus = cmsSessionState.kind === "checking"
    ? "CMSを確認中…"
    : cmsSessionState.kind === "unavailable"
      ? "CMSに接続できません"
      : cmsAssociationRequired
        ? "保存先を選択してください"
        : cmsSaveLabel[effectiveCmsSaveState];
  const cmsEditorVisualState: CmsSaveState = cmsSessionState.kind === "checking"
    ? "saving"
    : cmsSessionState.kind === "unavailable"
      ? "error"
      : effectiveCmsSaveState;
  const cmsSaveDisabled = Boolean(
    !cmsSession?.capabilities.canEdit ||
    editorLocked ||
    cmsOperationBusy ||
    cmsSaveState === "saving" ||
    cmsAssociationRequired ||
    Boolean(cmsRecoveryReference) ||
    cmsConflict ||
    (Boolean(cmsArticle) && !cmsDirty && cmsSaveState !== "error")
  );
  const cmsSaveButtonLabel = cmsSaveState === "saving"
    ? "保存中…"
    : cmsArticle
      ? "保存"
      : "CMSに保存";

  return (
    <div className="studio-shell">
      {studioView === "editor" ? (
        <div className="studio-editor-toolbar" aria-label="記事編集の操作" role="group">
          <button
            className="dads-button studio-library-shortcut"
            data-size="md"
            data-type="outline"
            onClick={showArticleLibrary}
            type="button"
          >
            記事一覧
          </button>
          <p
            aria-live="polite"
            className={`studio-editor-toolbar__status is-${cmsEditorVisualState}`}
          >
            {cmsEditorStatus}
          </p>
          <button
            className="dads-button studio-assets-shortcut"
            data-size="md"
            data-type="outline"
            onClick={showAssetLibrary}
            type="button"
          >
            Assets
          </button>
          <button
            aria-controls="studio-article-settings"
            aria-expanded={settingsOpen && settingsMode === "metadata"}
            className="dads-button studio-settings-shortcut"
            data-size="md"
            data-type="outline"
            onClick={() => {
              setPreviewFullscreen(false);
              setSettingsMode("metadata");
              setSettingsOpen((current) => settingsMode === "metadata" ? !current : true);
            }}
            type="button"
          >
            記事情報
            {validationVisible && settingsErrorCount > 0 ? ` (${settingsErrorCount})` : ""}
          </button>
          <button
            aria-controls="studio-article-settings"
            aria-expanded={settingsOpen && settingsMode === "workflow"}
            className="dads-button studio-workflow-shortcut"
            data-size="md"
            data-type="outline"
            onClick={() => {
              setPreviewFullscreen(false);
              setSettingsMode("workflow");
              setSettingsOpen((current) => settingsMode === "workflow" ? !current : true);
            }}
            type="button"
          >
            レビュー・公開
          </button>
          <button
            className="dads-button studio-save-shortcut"
            data-size="md"
            data-type="solid-fill"
            disabled={cmsSaveDisabled}
            onClick={() => void saveCmsDraft(true)}
            type="button"
          >
            {cmsSaveButtonLabel}
          </button>
        </div>
      ) : null}

      {studioView !== "editor" ? (
        <nav aria-label="Studioの主要機能" className="studio-primary-nav">
          <strong>Noema Studio</strong>
          <div>
            <button aria-current={studioView === "articles" ? "page" : undefined} onClick={showArticleLibrary} type="button">記事</button>
            <button aria-current={studioView === "assets" ? "page" : undefined} onClick={showAssetLibrary} type="button">画像</button>
          </div>
        </nav>
      ) : null}

      {operationMessage ? (
        <div className={`studio-notification is-${operationMessage.tone}`} role={operationMessage.tone === "error" ? "alert" : "status"}>
          <span>{operationMessage.text}</span>
          <button type="button" onClick={() => setOperationMessage(null)} aria-label="通知を閉じる">閉じる</button>
        </div>
      ) : null}

      {studioView === "articles" ? (
        <CmsArticleLibrary
          articles={cmsArticles}
          busy={cmsOperationBusy || cmsSaveState === "saving"}
          canCreate={Boolean(cmsSession?.capabilities.canEdit) && !editorLocked}
          canOpenArticles={Boolean(cmsSession?.capabilities.canEdit) && !editorLocked}
          connection={cmsLibraryConnection}
          filter={cmsArticleFilter}
          hasRecoveryDraft={hasRecoveryDraft && !cmsArticle}
          hasWorkingEditor={Boolean(cmsArticle || cmsRecoveryReference)}
          onFilterChange={setCmsArticleFilter}
          onContinueRecovery={showEditor}
          onContinueRecoveryAsNew={continueRecoveryAsNewArticle}
          onCreate={startNewCmsArticle}
          onDownloadRecovery={downloadRecoveryCopy}
          onEdit={(articleId) => { void loadCmsArticle(articleId); }}
          onQueryChange={setCmsArticleQuery}
          onRetry={() => setCmsRefresh((current) => current + 1)}
          onReturnToEditor={showEditor}
          openingArticleId={openingArticleId}
          query={cmsArticleQuery}
          recoveryCharacterCount={body.length}
          recoveryNeedsArticleAssociation={cmsAssociationRequired}
          recoverySaveStatus={saveStatus}
          recoveryTitle={frontmatter.title}
          workingArticleStatus={cmsLibraryWorkingStatus}
        />
      ) : studioView === "assets" ? (
        <CmsAssetLibrary
          assets={cmsAssets}
          busy={assetOperationBusy}
          canEdit={Boolean(cmsSession?.capabilities.canEdit)}
          connection={cmsAssetConnection}
          onRetry={() => setCmsRefresh((current) => current + 1)}
          onUpdate={saveAsset}
          onUpload={uploadAssets}
        />
      ) : (
        <>
      {cmsAssociationRequired ? (
        <section className="studio-cms-association" aria-labelledby="studio-cms-association-heading">
          <div>
            <p className="studio-cms-association__eyebrow">安全な復旧の確認</p>
            <h2 id="studio-cms-association-heading">この原稿の保存先を選んでください</h2>
            <p>以前のStudioから復元したため、既存記事か新規記事かを自動判定できません。元の記事へ戻す場合は一覧から選び、新しい原稿なら新規記事として続けます。</p>
          </div>
          <div className="studio-cms-association__actions">
            <button className="dads-button" data-size="md" data-type="solid-fill" onClick={showArticleLibrary} type="button">元の記事を選ぶ</button>
            <button className="dads-button" data-size="md" data-type="outline" onClick={continueRecoveryAsNewArticle} type="button">新しい記事として続ける</button>
          </div>
        </section>
      ) : null}
      <main className="studio-workspace">
        <h1 className="sr-only">Noema Studio 記事エディター</h1>
        <aside
          aria-label="記事設定"
          className={`studio-settings is-${settingsMode}`}
          hidden={!settingsOpen}
          id="studio-article-settings"
        >
          <div className="studio-settings__header">
            <div>
              <h2>{settingsMode === "workflow" ? "レビュー・公開" : "記事情報"}</h2>
              <p>{settingsMode === "workflow" ? "記事の状態を確認し、次の工程へ進めます。" : "本文から自動整理されます。必要な項目だけ確認・修正できます。"}</p>
            </div>
            <button className="dads-button" data-size="sm" data-type="outline" onClick={() => setSettingsOpen(false)} type="button">
              閉じる
            </button>
          </div>

          <section className="studio-autofill" aria-labelledby="studio-autofill-heading">
            <div>
              <h3 id="studio-autofill-heading">本文から自動整理</h3>
              <p>概要・到達点・URL・テーマ・記事タイプ・タグ・読了時間を、外部送信せずに本文から整えます。</p>
            </div>
            <button
              className="dads-button"
              data-size="sm"
              data-type="outline"
              disabled={editorLocked || body.trim().length < 20}
              onClick={() => {
                manuallyEditedMetadata.current.clear();
                applyAutomaticMetadata(true);
                setOperationMessage({ text: "本文から記事情報を整理しました。必要な箇所だけ確認してください。", tone: "success" });
              }}
              type="button"
            >
              もう一度自動整理
            </button>
          </section>

          <details className="studio-cms studio-cms-workflow" id="cms-workflow" open={settingsMode === "workflow"}>
            <summary className="studio-cms-workflow__summary">
              <span>保存・レビュー・公開</span>
              <small>{cmsArticle ? `${cmsReviewStatusLabels[cmsArticle.reviewStatus]}・${cmsPublicationStatusLabels[cmsArticle.publicationStatus]}` : "未登録・未公開"}</small>
            </summary>

            {cmsSessionState.kind === "checking" ? (
              <p className="studio-cms__session" role="status">CMSの権限を確認しています…</p>
            ) : null}
            {cmsSessionState.kind === "unavailable" ? (
              <div className="studio-cms__unavailable" role="alert">
                <p><strong>CMSを利用できません。</strong> {cmsSessionState.error.message}</p>
                <p>入力はブラウザの復旧コピーに残ります。必要ならMarkdownを書き出してください。</p>
                <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => setCmsRefresh((current) => current + 1)}>
                  もう一度確認
                </button>
              </div>
            ) : null}
            {cmsSession ? (
              <p className="studio-cms__session">
                <strong>{cmsRoleLabels[cmsSession.identity.role]}</strong>
                <span>{cmsSession.identity.email}</span>
              </p>
            ) : null}

            <div className="studio-cms__current-article">
              <span>編集中の記事</span>
              <strong>{frontmatter.title || "新しい記事"}</strong>
              <small>{cmsArticle ? `revision ${cmsArticle.revisionNumber}` : "最初の保存でCMSに登録されます"}</small>
            </div>

            <div className="studio-cms__status-pair" aria-label="記事の状態">
              <span>レビュー: {cmsArticle ? cmsReviewStatusLabels[cmsArticle.reviewStatus] : "未登録"}</span>
              <span>公開: {cmsArticle ? cmsPublicationStatusLabels[cmsArticle.publicationStatus] : "未公開"}</span>
            </div>
            {cmsArticle?.publishedRevisionNumber !== null && cmsArticle?.publishedRevisionNumber !== undefined ? (
              <p className="studio-cms__published-note">
                公開中はrevision {cmsArticle.publishedRevisionNumber}です。現在のrevision {cmsArticle.revisionNumber}を編集しても、承認して公開するまで読者向け内容は変わりません。
              </p>
            ) : null}
            {cmsArticle?.publicationStatus === "published" && cmsArticle.publishedSlug ? (
              <a
                className="dads-button studio-cms__public-link"
                data-size="sm"
                data-type="outline"
                href={`${publicSiteUrl.replace(/\/$/, "")}/articles/${encodeURIComponent(cmsArticle.publishedSlug)}/`}
                rel="noreferrer"
                target="_blank"
              >
                公開中の記事を見る <Icon name="external" />
              </a>
            ) : null}
            {cmsArticle?.reviewNote ? (
              <p className="studio-cms__review-note"><strong>レビューコメント:</strong> {cmsArticle.reviewNote}</p>
            ) : null}

            <details className="studio-disclosure studio-visibility-disclosure">
              <summary>公開範囲: {cmsVisibilityLabels[cmsVisibility]}</summary>
              <div className="studio-disclosure__content">
                <fieldset className="studio-cms__visibility" disabled={!cmsSession?.capabilities.canEdit || editorLocked}>
                  <legend className="sr-only">公開範囲</legend>
                  {(Object.keys(cmsVisibilityLabels) as CmsVisibility[]).map((visibility) => (
                    <label key={visibility} className={visibility === "restricted" ? "is-pending" : ""}>
                      <input
                        checked={cmsVisibility === visibility}
                        name="cms-visibility"
                        onChange={() => setCmsVisibility(visibility)}
                        type="radio"
                        value={visibility}
                      />
                      <span><strong>{cmsVisibilityLabels[visibility]}</strong><small>{cmsVisibilityDescriptions[visibility]}</small></span>
                    </label>
                  ))}
                </fieldset>
              </div>
            </details>

            {cmsConflict ? (
              <div className="studio-cms__conflict" role="alert">
                <h3>別の編集者による更新があります</h3>
                <p>入力中の内容はこの画面と復旧コピーに保持しています。先に書き出すか、内容を破棄してCMSの最新版を読み込んでください。</p>
                <div className="studio-cms__actions">
                  <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={downloadRecoveryCopy}>復旧用Markdownを書き出す</button>
                  <button className="dads-button" data-size="sm" data-type="solid-fill" disabled={cmsOperationBusy} type="button" onClick={() => void reloadLatestCmsArticle()}>CMSの最新版を読み込む</button>
                </div>
              </div>
            ) : null}

            <div className="studio-cms__actions">
              {cmsCanRequestReview ? (
                <button
                  className="dads-button"
                  data-size="md"
                  data-type="outline"
                  disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict}
                  onClick={() => void runCmsAction("request_review")}
                  type="button"
                >
                  レビューを依頼
                </button>
              ) : null}
              {cmsCanReview ? (
                <button className="dads-button" data-size="md" data-type="solid-fill" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("approve")} type="button">
                  承認する
                </button>
              ) : null}
              {cmsCanRequestChanges ? (
                <button className="dads-button" data-size="md" data-type="outline" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("request_changes")} type="button">
                  修正を依頼
                </button>
              ) : null}
              {cmsCanPublish ? (
                <button className="dads-button" data-size="md" data-type="solid-fill" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("publish")} type="button">
                  承認済みrevisionを公開
                </button>
              ) : null}
              {cmsSession?.capabilities.canPublish && cmsArticle?.publicationStatus === "published" ? (
                <button className="dads-button" data-size="md" data-type="outline" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("archive")} type="button">
                  公開を終了して保管
                </button>
              ) : null}
              {cmsSession?.capabilities.canPublish && cmsArticle?.publicationStatus === "archived" ? (
                <button className="dads-button" data-size="md" data-type="outline" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("restore")} type="button">
                  未公開へ戻す
                </button>
              ) : null}
            </div>
            {cmsAutosavePaused ? (
              <p className="studio-cms__pending-message">復旧内容はまだCMSへ反映していません。内容を確認して「保存」を押すと、レビュー・公開操作を続けられます。</p>
            ) : null}
            {cmsVisibility === "restricted" ? (
              <p className="studio-cms__pending-message">指定メンバー公開は読者認証の接続後に公開できます。原稿の保存とレビューは先に進められます。</p>
            ) : null}
            {cmsVisibility === "internal" ? (
              <p className="studio-cms__pending-message">運営メンバーのみの記事はStudio内に保持し、読者向けサイトへは公開しません。原稿の保存とレビューは進められます。</p>
            ) : null}
            {cmsArticle?.reviewStatus === "in_review" && cmsSelfApprovalBlocked ? (
              <p className="studio-cms__pending-message">自分が保存した最新版は承認できません。別のレビュー担当者または管理者に承認を依頼してください。</p>
            ) : null}
            {cmsSession?.capabilities.canManageMembers ? (
              <details className="studio-cms-members">
                <summary>メンバー管理（{cmsMembers.length}人）</summary>
                <div className="studio-cms-members__content">
                  <p>メールアドレスを登録すると、Cloudflare Accessで初めてログインした時に役割が有効になります。同じメールを送信すると設定を更新します。</p>
                  <form onSubmit={(event) => void saveCmsMember(event)}>
                    <label htmlFor="cms-member-email">メールアドレス</label>
                    <input
                      autoComplete="email"
                      disabled={cmsMembersBusy}
                      id="cms-member-email"
                      onChange={(event) => setCmsMemberEmail(event.target.value)}
                      placeholder="editor@example.com"
                      required
                      type="email"
                      value={cmsMemberEmail}
                    />
                    <label htmlFor="cms-member-role">役割</label>
                    <select
                      disabled={cmsMembersBusy}
                      id="cms-member-role"
                      onChange={(event) => setCmsMemberRole(event.target.value as CmsRole)}
                      value={cmsMemberRole}
                    >
                      {(Object.keys(cmsRoleLabels) as CmsRole[]).map((role) => (
                        <option key={role} value={role}>{cmsRoleLabels[role]}</option>
                      ))}
                    </select>
                    <label className="studio-cms-members__active">
                      <input
                        checked={cmsMemberActive}
                        disabled={cmsMembersBusy}
                        onChange={(event) => setCmsMemberActive(event.target.checked)}
                        type="checkbox"
                      />
                      <span>このメンバーを有効にする</span>
                    </label>
                    <button className="dads-button" data-size="sm" data-type="solid-fill" disabled={cmsMembersBusy} type="submit">
                      {cmsMembersBusy ? "更新中…" : "招待・設定を保存"}
                    </button>
                  </form>
                  {cmsMembersError ? <p className="studio-cms-members__error" role="alert">{cmsMembersError}</p> : null}
                  <ul className="studio-cms-members__list">
                    {cmsMembers.map((member) => {
                      const isSelf = member.email.toLowerCase() === cmsSession.identity.email.toLowerCase();
                      return (
                        <li key={member.email}>
                          <div>
                            <strong>{member.email}</strong>
                            <span>{cmsRoleLabels[member.role]}・{member.active ? "有効" : "停止"}・{member.provisioned ? "利用開始済み" : "招待待ち"}</span>
                          </div>
                          {isSelf ? <span className="studio-cms-members__self">自分</span> : (
                            <button
                              className="dads-button"
                              data-size="sm"
                              data-type="outline"
                              disabled={cmsMembersBusy}
                              onClick={() => {
                                setCmsMemberEmail(member.email);
                                setCmsMemberRole(member.role);
                                setCmsMemberActive(member.active);
                              }}
                              type="button"
                            >
                              設定を編集
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
            ) : null}
            <details className="studio-save-help">
              <summary>保存の仕組み</summary>
              <p className="studio-cms__recovery-copy">ブラウザ保存は通信障害や競合時の復旧コピーです。共有・レビュー・公開の正本はCMSです。<span aria-live="polite">{saveStatus}</span></p>
            </details>
          </details>

          <details className="studio-disclosure studio-utilities">
            <summary>Markdownの入出力</summary>
            <div className="studio-disclosure__content">
              <div className="studio-file-actions">
                <input ref={importInput} aria-label="Markdownファイル" hidden type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => void importMarkdown(event.target.files?.[0])} />
                <button className="dads-button" data-size="sm" data-type="outline" disabled={editorLocked} type="button" onClick={() => importInput.current?.click()}>MDを読み込む</button>
                <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={download}>Markdownを書き出す <Icon name="download" /></button>
              </div>
            </div>
          </details>

          {editorLocked ? (
            <section className="studio-locked-summary" aria-labelledby="locked-summary-heading">
              <h2 id="locked-summary-heading">固定した送信内容</h2>
              <p className="studio-edit-lock" role="status">
                レビュー依頼の内容を安全に確認するため固定しています。本文は「本文」タブで選択・コピーできます。
              </p>
              <dl>
                <div><dt>タイトル</dt><dd>{frontmatter.title}</dd></div>
                <div><dt>スラッグ</dt><dd><code>{frontmatter.slug}</code></dd></div>
                <div><dt>概要</dt><dd>{frontmatter.description}</dd></div>
                <div><dt>読後の到達点</dt><dd>{frontmatter.outcome}</dd></div>
                <div><dt>執筆者</dt><dd>{frontmatter.authors.join("、")}</dd></div>
                <div><dt>テーマ</dt><dd>{frontmatter.topics.map((topic) => topicLabels[topic]).join("、")}</dd></div>
                <div><dt>公開状態</dt><dd>{frontmatter.status === "published" ? "公開予定" : frontmatter.status === "archived" ? "非公開・保管" : "下書き"}</dd></div>
                <div><dt>公開日</dt><dd>{frontmatter.publishedAt ? formatArticleDate(frontmatter.publishedAt) : "なし"}</dd></div>
                <div><dt>更新日</dt><dd>{formatArticleDate(frontmatter.updatedAt)}</dd></div>
                <div><dt>記事タイプ</dt><dd>{approachLabels[frontmatter.approach]}</dd></div>
                <div><dt>読了時間</dt><dd>{frontmatter.estimatedMinutes}分</dd></div>
                <div><dt>タグ</dt><dd>{frontmatter.tags.length > 0 ? frontmatter.tags.join("、") : "なし"}</dd></div>
                <div><dt>前提知識</dt><dd>{frontmatter.prerequisites.length > 0 ? frontmatter.prerequisites.join("、") : "なし"}</dd></div>
                <div><dt>記事画像</dt><dd>{frontmatter.heroImage ? <><code>{frontmatter.heroImage.src}</code><br />{frontmatter.heroImage.alt}</> : "なし"}</dd></div>
                <div><dt>参考資料</dt><dd>{frontmatter.sources.length > 0 ? (
                  <ul>{frontmatter.sources.map((source, index) => <li key={`${source.url}-${index}`}>{source.title} — {source.url}（{source.checkedAt}確認）</li>)}</ul>
                ) : "なし"}</dd></div>
              </dl>
            </section>
          ) : null}

          <fieldset className="studio-form-fieldset" hidden={editorLocked}>
            <legend className="sr-only">記事情報</legend>
            <details className="studio-disclosure" open={summaryOpen} onToggle={(event) => setSummaryOpen(event.currentTarget.open)}>
              <summary>タイトルと概要 — {frontmatter.title || "自動整理待ち"}</summary>
              <div className="studio-disclosure__content">
            {(() => {
              const error = fieldError(visibleReviewIssues, "title", validationVisible);
              return <Field id="article-title" label="タイトル" counter={`${frontmatter.title.length} / 100文字`} error={error}>
                <input id="article-title" className="dads-input-text__input" required {...inputA11y("article-title", false, error, true)} value={frontmatter.title} onChange={(event) => update("title", event.target.value)} />
              </Field>;
            })()}
            {(() => {
              const error = fieldError(visibleReviewIssues, "description", validationVisible);
              return <Field id="article-description" label="概要" support="一覧や検索結果にも表示される短い説明です。" counter={`${frontmatter.description.length} / 180文字`} error={error}>
                <textarea id="article-description" className="dads-textarea__textarea" required rows={4} {...inputA11y("article-description", true, error, true)} value={frontmatter.description} onChange={(event) => update("description", event.target.value)} />
              </Field>;
            })()}
            {(() => {
              const error = fieldError(visibleReviewIssues, "outcome", validationVisible);
              return <Field id="article-outcome" label="この記事でできるようになること" support="読者が読み終えたあとに得られる変化を書きます。" counter={`${frontmatter.outcome.length} / 180文字`} error={error}>
                <textarea id="article-outcome" className="dads-textarea__textarea" required rows={3} {...inputA11y("article-outcome", true, error, true)} value={frontmatter.outcome} onChange={(event) => update("outcome", event.target.value)} />
              </Field>;
            })()}
            {(() => {
              const error = fieldError(visibleReviewIssues, "slug", validationVisible);
              return <Field id="article-slug" label="スラッグ" support="記事URLに使う半角英数字とハイフンです。" error={error}>
                <input id="article-slug" className="dads-input-text__input" required {...inputA11y("article-slug", true, error)} value={frontmatter.slug} onChange={(event) => update("slug", event.target.value)} placeholder="getting-started-with-ai" />
              </Field>;
            })()}
              </div>
            </details>

            <details className="studio-disclosure" open={metadataOpen} onToggle={(event) => setMetadataOpen(event.currentTarget.open)}>
              <summary>公開と分類 — {approachLabels[frontmatter.approach]} / {frontmatter.topics[0] ? topicLabels[frontmatter.topics[0]] : "テーマ未選択"}</summary>
              <div className="studio-disclosure__content">
                {(() => {
                  const error = fieldError(visibleReviewIssues, "authors", validationVisible);
                  return <Field id="article-authors" label="執筆者" support="複数の場合はカンマで区切ります。" error={error}>
                    <input id="article-authors" className="dads-input-text__input" required {...inputA11y("article-authors", true, error)} value={frontmatter.authors.join(", ")} onChange={(event) => update("authors", event.target.value.split(",").map((author) => author.trim()))} onBlur={() => update("authors", frontmatter.authors.filter(Boolean))} />
                  </Field>;
                })()}
                <div className="studio-field-row">
                  {(() => {
                    const error = fieldError(visibleReviewIssues, "publishedAt", validationVisible);
                    return <Field id="article-published-at" label="互換用の公開日" required={false} support="Markdown取込時の互換メタデータです。実際の公開日時はCMSで公開した時に自動記録されます。" error={error}>
                      <input id="article-published-at" className="dads-input-text__input" type="date" {...inputA11y("article-published-at", true, error, false, false)} value={frontmatter.publishedAt ?? ""} onChange={(event) => update("publishedAt", event.target.value || undefined)} />
                    </Field>;
                  })()}
                  {(() => {
                    const error = fieldError(visibleReviewIssues, "updatedAt", validationVisible);
                    return <Field id="article-updated-at" label="更新日" error={error}>
                      <input id="article-updated-at" className="dads-input-text__input" type="date" required {...inputA11y("article-updated-at", false, error)} value={frontmatter.updatedAt} onChange={(event) => update("updatedAt", event.target.value)} />
                    </Field>;
                  })()}
                </div>
                <div className="studio-field-row">
                  {(() => {
                    const error = fieldError(visibleReviewIssues, "approach", validationVisible);
                    return <Field id="article-approach" label="記事タイプ" error={error}>
                      <select id="article-approach" required {...inputA11y("article-approach", false, error)} value={frontmatter.approach} onChange={(event) => update("approach", event.target.value as ArticleFrontmatter["approach"])}>
                        {Object.entries(approachLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </Field>;
                  })()}
                  {(() => {
                    const error = fieldError(visibleReviewIssues, "estimatedMinutes", validationVisible);
                    return <Field id="article-minutes" label="読了時間（分）" error={error}>
                      <input id="article-minutes" className="dads-input-text__input" type="number" min="1" max="180" required {...inputA11y("article-minutes", false, error)} value={frontmatter.estimatedMinutes || ""} onChange={(event) => update("estimatedMinutes", Number(event.target.value))} />
                    </Field>;
                  })()}
                </div>
                {(() => {
                  const error = fieldError(visibleReviewIssues, "topics", validationVisible);
                  return (
                    <fieldset
                      aria-describedby={`article-topic-support article-topic-count${error ? " article-topic-error" : ""}`}
                      aria-errormessage={error ? "article-topic-error" : undefined}
                      aria-invalid={error ? true : undefined}
                      className={`studio-field studio-topic-field ${error ? "has-error" : ""}`}
                      id="article-topic"
                      tabIndex={-1}
                    >
                      <legend className="dads-form-control-label studio-field__label">
                        <span>テーマ</span>
                        <span className="studio-field__requirement">※必須</span>
                      </legend>
                      <p className="studio-field__support" id="article-topic-support">1〜{MAX_ARTICLE_TOPICS}つ選びます。最初に選んだテーマが公開画面の主テーマになり、選択内容はすべて記事に保存されます。</p>
                      <div className="studio-topic-options">
                        {Object.entries(topicLabels).map(([value, label]) => {
                          const topic = value as ArticleFrontmatter["topics"][number];
                          const selected = frontmatter.topics.includes(topic);
                          return (
                            <label className="studio-topic-option" htmlFor={`article-topic-${value}`} key={value}>
                              <input
                                aria-describedby={`article-topic-support article-topic-count${error ? " article-topic-error" : ""}`}
                                aria-invalid={error ? true : undefined}
                                checked={selected}
                                disabled={isArticleTopicChoiceDisabled(frontmatter.topics, topic)}
                                id={`article-topic-${value}`}
                                onChange={(event) => update("topics", toggleArticleTopic(frontmatter.topics, topic, event.target.checked))}
                                type="checkbox"
                              />
                              <span>{label}{selected && frontmatter.topics[0] === topic ? "（主テーマ）" : ""}</span>
                            </label>
                          );
                        })}
                      </div>
                      <p
                        aria-live="polite"
                        className={frontmatter.topics.length > MAX_ARTICLE_TOPICS ? "studio-field__error" : "studio-field__counter"}
                        id="article-topic-count"
                      >
                        選択中 {frontmatter.topics.length} / {MAX_ARTICLE_TOPICS}
                        {frontmatter.topics.length > MAX_ARTICLE_TOPICS ? ` — ${MAX_ARTICLE_TOPICS}つまでに減らしてください` : ""}
                      </p>
                      {error ? <p className="studio-field__error" id="article-topic-error">エラー — {error}</p> : null}
                    </fieldset>
                  );
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "tags", validationVisible);
                  return <Field id="article-tags" label="タグ" required={false} support="入力してEnterまたは「追加」を押します。後から個別に外せます。" error={error}>
                    <TagEditor
                      disabled={editorLocked}
                      error={error}
                      onChange={(tags) => update("tags", tags)}
                      tags={frontmatter.tags.filter(Boolean)}
                    />
                  </Field>;
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "prerequisites", validationVisible);
                  return <Field id="article-prerequisites" label="前提知識" required={false} support="不要な場合は空欄。複数の場合はカンマで区切ります。" error={error}>
                    <input id="article-prerequisites" className="dads-input-text__input" {...inputA11y("article-prerequisites", true, error, false, false)} value={frontmatter.prerequisites.join(", ")} onChange={(event) => update("prerequisites", event.target.value.split(",").map((item) => item.trim()))} onBlur={() => update("prerequisites", frontmatter.prerequisites.filter(Boolean))} />
                  </Field>;
                })()}
              </div>
            </details>

            <details className="studio-disclosure" open={mediaOpen} onToggle={(event) => setMediaOpen(event.currentTarget.open)}>
              <summary>記事画像{fieldError(visibleReviewIssues, "heroImage", validationVisible) ? "（要確認）" : "（任意）"}</summary>
              <div className="studio-disclosure__content">
                <button
                  className="dads-button studio-hero-asset-button"
                  data-size="md"
                  data-type="outline"
                  disabled={editorLocked || assetOperationBusy || !cmsSession?.capabilities.canEdit}
                  id="article-hero-asset"
                  onClick={() => setAssetPickerTarget("hero")}
                  type="button"
                >
                  {frontmatter.heroImage ? "Assetsから記事画像を変更" : "Assetsから記事画像を選ぶ"}
                </button>
                {frontmatter.heroImage ? (
                  <div className="studio-hero-asset-preview">
                    <PreviewHeroImage image={frontmatter.heroImage} />
                    <button className="dads-button" data-size="sm" data-type="outline" onClick={() => update("heroImage", null)} type="button">記事画像を外す</button>
                  </div>
                ) : null}
                <details className="studio-manual-media-path">
                  <summary>画像パスを手動で指定</summary>
                {(() => {
                  const error = fieldError(visibleReviewIssues, "heroImage", validationVisible, "src");
                  return <Field id="article-hero-image" label="画像パス" required={false} support="/images/articles/ 以下のサイト内パスを指定します。" error={error}>
                    <input id="article-hero-image" className="dads-input-text__input" {...inputA11y("article-hero-image", true, error, false, false)} value={frontmatter.heroImage?.src ?? ""} onChange={(event) => update("heroImage", event.target.value ? { src: event.target.value, alt: frontmatter.heroImage?.alt ?? "" } : null)} placeholder="/images/articles/example.webp" />
                  </Field>;
                })()}
                </details>
                {frontmatter.heroImage ? (
                  (() => {
                    const error = fieldError(visibleReviewIssues, "heroImage", validationVisible, "alt");
                    return <Field id="article-hero-image-alt" label="代替テキスト" support="画像から得られる情報を簡潔に説明します。" error={error}>
                      <textarea id="article-hero-image-alt" className="dads-textarea__textarea" required rows={3} {...inputA11y("article-hero-image-alt", true, error)} value={frontmatter.heroImage!.alt} onChange={(event) => update("heroImage", { ...frontmatter.heroImage!, alt: event.target.value })} />
                    </Field>;
                  })()
                ) : null}
              </div>
            </details>

            <details className="studio-disclosure" open={sourcesOpen} onToggle={(event) => setSourcesOpen(event.currentTarget.open)}>
              <summary>参考資料（{frontmatter.sources.length}件）{fieldError(visibleReviewIssues, "sources", validationVisible) ? "・要確認" : ""}</summary>
              <div className="studio-disclosure__content" id="article-sources" tabIndex={-1}>
                <p className="studio-field__support">レビューへ送る資料URLにはhttpsを使用します。</p>
                {frontmatter.sources.map((source, index) => {
                  const titleError = sourceFieldError(visibleReviewIssues, index, "title", validationVisible);
                  const urlError = sourceFieldError(visibleReviewIssues, index, "url", validationVisible);
                  const checkedAtError = sourceFieldError(visibleReviewIssues, index, "checkedAt", validationVisible);
                  return (
                    <div className="studio-source" key={index}>
                      <Field id={`article-source-title-${index}`} label={`資料 ${index + 1} の名前`} error={titleError}>
                        <input id={`article-source-title-${index}`} className="dads-input-text__input" required {...inputA11y(`article-source-title-${index}`, false, titleError)} value={source.title} onChange={(event) => updateSource(index, "title", event.target.value)} />
                      </Field>
                      <Field id={`article-source-url-${index}`} label="URL" error={urlError}>
                        <input id={`article-source-url-${index}`} className="dads-input-text__input" type="url" required {...inputA11y(`article-source-url-${index}`, false, urlError)} value={source.url} onChange={(event) => updateSource(index, "url", event.target.value)} />
                      </Field>
                      <Field id={`article-source-date-${index}`} label="確認日" error={checkedAtError}>
                        <input id={`article-source-date-${index}`} className="dads-input-text__input" type="date" required {...inputA11y(`article-source-date-${index}`, false, checkedAtError)} value={source.checkedAt} onChange={(event) => updateSource(index, "checkedAt", event.target.value)} />
                      </Field>
                      <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => update("sources", frontmatter.sources.filter((_, sourceIndex) => sourceIndex !== index))}>この資料を削除</button>
                    </div>
                  );
                })}
                <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => update("sources", [...frontmatter.sources, { title: "", url: "", checkedAt: new Date().toISOString().slice(0, 10) }])}>参考資料を追加</button>
              </div>
            </details>
          </fieldset>

          {validationVisible ? (
            <section ref={validationSection} id="article-validation" className={`studio-validation ${blockingErrorCount > 0 ? "has-errors" : "is-ready"}`} tabIndex={-1}>
              <h2>{blockingErrorCount === 0 ? <Icon name="check" /> : <Icon name="warning" />} 入力チェック</h2>
              {blockingErrorCount > 0 ? <p><strong>{blockingErrorCount}件</strong>の入力を確認するとレビューへ送れます。</p> : <p>レビュー依頼に必要な項目が揃っています。</p>}
              {visibleSettingsIssues.slice(0, 10).map((issue, index) => (
                <button className="studio-validation__issue" key={`${issue.path.join(".")}-${issue.message}-${index}`} type="button" onClick={() => focusReviewIssue(issue)}>
                  エラー — {issue.message}
                </button>
              ))}
              {visibleSettingsIssues.length > 10 ? (
                <p className="studio-validation__remaining">ほか{visibleSettingsIssues.length - 10}件あります。各入力欄のエラーも確認してください。</p>
              ) : null}
              {visibleReviewIssues.filter((issue) => normalizedIssueField(issue) === "markdown" && bodyErrors.length === 0).map((issue, index) => (
                <button className="studio-validation__issue" key={`markdown-${issue.message}-${index}`} type="button" onClick={() => focusBodyIssue()}>
                  エラー — 本文: {issue.message}
                </button>
              ))}
              {bodyIssues.map((issue) => (
                <button className={`studio-validation__issue ${issue.severity === "warning" ? "is-warning" : ""}`} key={`${issue.code}-${issue.line}-${issue.message}`} type="button" onClick={() => focusBodyIssue(issue)}>
                  {issue.severity === "error" ? "エラー" : "確認"} — 本文{issue.line}行: {issue.message}
                </button>
              ))}
              {editorialWarnings.map((warning) => <p className="studio-validation__warning" key={warning}>確認 — {warning}</p>)}
            </section>
          ) : null}


        </aside>

        <section
          aria-labelledby="editor-heading"
          className={`studio-editor ${editorLocked ? "has-lock" : ""} ${previewFullscreen ? "is-preview-fullscreen" : ""}`}
          id="studio-editor"
        >
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div>
              <h2 id="editor-heading">{previewFullscreen ? "記事プレビュー" : "Markdown本文"}</h2>
              <p className="studio-pane-title__context">書くことに集中できるよう、記事情報は本文から自動整理します。</p>
            </div>
            <div className="studio-editor__status">
              <span>{body.length.toLocaleString("ja-JP")}文字</span>
              <button
                aria-pressed={previewFullscreen}
                className="studio-preview-toggle"
                onClick={() => {
                  setSettingsOpen(false);
                  setPreviewFullscreen((current) => !current);
                }}
                type="button"
              >
                {previewFullscreen ? "Markdown編集に戻る" : "プレビューを全画面"}
              </button>
              {validationVisible && blockingErrorCount > 0 ? <button type="button" onClick={focusValidation} aria-controls="article-validation">入力エラー{blockingErrorCount}件を確認</button> : null}
            </div>
          </div>
          {editorLocked ? <p className="studio-editor__lock" role="status">送信内容を固定しています。本文は選択してコピーできます。</p> : null}
          <div className="studio-markdown-toolbar" aria-label="Markdown編集ツール">
            <button
              className="dads-button"
              data-size="sm"
              data-type="outline"
              disabled={editorLocked || assetOperationBusy || !cmsSession?.capabilities.canEdit}
              onClick={() => setAssetPickerTarget("body")}
              type="button"
            >
              Assetsから画像を挿入
            </button>
            <span>既存画像の再利用、または新しい画像のアップロード</span>
          </div>
          <div className={`studio-writing-layout has-preview ${previewFullscreen ? "is-preview-only" : ""}`}>
            <div className="studio-writing-canvas" hidden={previewFullscreen}>
              <label className="sr-only" htmlFor="article-body">Markdown本文</label>
              <textarea
                aria-describedby="article-body-help"
                aria-errormessage={bodyInvalid ? "article-body-error" : undefined}
                aria-invalid={bodyInvalid || undefined}
                aria-required="true"
                aria-readonly={editorLocked}
                id="article-body"
                onChange={(event) => { if (!editorLocked) { setBody(event.target.value); setPublicationIssues([]); } }}
                placeholder="## はじめに\n\nここからMarkdownで本文を書きます。"
                readOnly={editorLocked}
                required
                ref={bodyInput}
                spellCheck="true"
                value={body}
              />
            </div>
            <div className="studio-live-preview studio-preview" aria-label="ライブプレビュー">
              <div className="studio-live-preview__heading">
                <strong>{previewFullscreen ? "記事プレビュー" : "ライブプレビュー"}</strong>
                <span>自動更新</span>
              </div>
              <ArticlePreviewContent frontmatter={frontmatter} previewHtml={previewHtml} />
            </div>
          </div>
          <p className="sr-only" id="article-body-help">Markdown形式で本文を入力します。H1見出しとraw HTMLは使用できません。</p>
          <p className="sr-only" id="article-body-error">{bodyErrorMessage ? `エラー — ${bodyErrorMessage}` : ""}</p>
        </section>

      </main>
        </>
      )}

      {assetPickerTarget ? (
        <CmsAssetPicker
          assets={cmsAssets}
          busy={assetOperationBusy}
          mode={assetPickerTarget}
          onClose={closeAssetPicker}
          onInsert={insertAsset}
          onUpload={uploadAssets}
        />
      ) : null}

    </div>
  );
}
