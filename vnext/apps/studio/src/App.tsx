import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode
} from "react";
import DOMPurify from "dompurify";
import {
  articleFrontmatterSchema,
  approachLabels,
  parseArticle,
  serializeArticle,
  topicLabels,
  validateArticleMarkdown,
  type ArticleFrontmatter,
  type ArticleMarkdownIssue
} from "@noema/content";
import {
  renderArticlePresentation,
} from "@noema/content/article-presentation";
import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsVisibilityLabels,
  validateCmsArticleForReview,
  type CmsArticleAction,
  type CmsArticleDetail,
  type CmsArticleSummary,
  type CmsArticleVersionDetail,
  type CmsAsset,
  type CmsAssetStatus,
  type CmsEditorialIssue,
  type CmsMember,
  type CmsRole,
  type CmsReviewComment,
  type CmsReviewCommentTarget,
  type CmsSession,
  type CmsSeries,
  type CmsSeriesVersion,
  type CmsVisibility
} from "@noema/cms";
import {
  createCmsSeriesRecord,
  createCmsArticle as createCmsArticleRecord,
  createCmsReviewCommentRecord,
  configureStudioPassword,
  fetchCmsArticle,
  fetchCmsArticles,
  fetchCmsAssets,
  fetchCmsMembers,
  fetchCmsReviewComments,
  fetchCmsSession,
  fetchCmsSeries,
  fetchCmsSeriesVersions,
  signInStudio,
  runCmsArticleAction,
  updateCmsArticle as updateCmsArticleRecord,
  updateCmsSeriesRecord,
  updateCmsAsset as updateCmsAssetRecord,
  deleteCmsAsset as deleteCmsAssetRecord,
  uploadCmsAsset,
  upsertCmsMember,
  type CmsClientError,
  type CmsSeriesContent
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
import {
  createPreviewMarkdown,
  resolvePreviewImageReference,
  resolvePublicSiteReference
} from "./preview-markdown";
import {
  MAX_ARTICLE_TOPICS,
  isArticleTopicChoiceDisabled,
  toggleArticleTopic
} from "./topic-selection";
import {
  cmsRecoveryNeedsConflictCheck,
  initialCmsRecoverySaveState,
  resolveCmsRecoveryState
} from "./cms-recovery";
import {
  CmsArticleLibrary,
  type CmsLibraryConnection
} from "./CmsArticleLibrary";
import type { CmsArticleFilter } from "./article-library";
import { suggestArticleMetadata } from "./article-autofill";
import { CmsAssetLibrary } from "./CmsAssetLibrary";
import { CmsAssetPicker } from "./CmsAssetPicker";
import { CmsAssetTray, noemaAssetDragType } from "./CmsAssetTray";
import { CmsPublicationJourney, getCmsWorkflowShortcut } from "./CmsPublicationJourney";
import { CmsVersionHistory } from "./CmsVersionHistory";
import { CmsTeamSettings } from "./CmsTeamSettings";
import { CmsArticleSeriesEditor } from "./CmsArticleSeriesEditor";
import { CmsPasswordLoginMigration } from "./CmsPasswordLoginMigration";
import { CmsLogin } from "./CmsLogin";
import {
  CmsConflictResolver,
  type ResolvedCmsConflictDraft
} from "./CmsConflictResolver";
import { mergeCmsDraftOntoLatest, type CmsDraftContent } from "./cms-conflict";
import {
  StudioNotification,
  type StudioNotificationMessage
} from "./StudioNotification";
import {
  clampStudioPanelWidth,
  defaultStudioPanelWidth,
  StudioPanelResizeHandle
} from "./StudioPanelResizeHandle";
import { StudioSurfaceHeader } from "./StudioSurfaceHeader";
import { buildArticlePreviewSeries } from "./article-preview-series";
import {
  readStudioView,
  studioViewHref,
  writeStudioHistory,
  type StudioView
} from "./studio-navigation";
import {
  completeCmsEditSessionSave,
  createCmsEditSession,
  ensureActiveCmsEditSession
} from "./cms-versioning";

type StudioSettingsMode = "metadata" | "publish" | "review" | "series";
type CmsSessionState =
  | { kind: "checking" }
  | { kind: "ready"; session: CmsSession }
  | { error: CmsClientError; kind: "unavailable" };
type CmsSaveState = "local" | "dirty" | "saving" | "saved" | "conflict" | "error";
type CmsConflictLatestState =
  | { kind: "idle" | "loading" }
  | { error: CmsClientError; kind: "error" }
  | { article: CmsArticleDetail; kind: "ready" };

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
  message: StudioNotificationMessage | null;
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
              text: "前回編集中だったCMS記事の復旧内容を保持しています。記事一覧からCMS最新版と比較し、競合がある場合は解消へ進めます。",
              title: "復旧原稿を保持しています",
              tone: "info"
            }
          : null,
      saveStatus: cmsReference
        ? "復旧コピーをブラウザに保持中"
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
          title: "自動保存を利用できません",
          tone: "error"
        }
      : loadedDraft.status === "invalid"
      ? {
          text: "保存した下書きを安全に読み込めなかったため、新しい記事を開きました。",
          title: "下書きを復元できませんでした",
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

function PreviewHeroImage({ image }: { image: NonNullable<ArticleFrontmatter["heroImage"]> }) {
  const [failed, setFailed] = useState(false);
  const src = resolvePreviewImageReference(image.src, publicSiteUrl);

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

  return <img src={src} alt={image.alt} onError={() => setFailed(true)} />;
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
  const [initialStudioView] = useState<StudioView>(() => {
    return typeof window === "undefined"
      ? "articles"
      : readStudioView(window.location.pathname);
  });
  const [frontmatter, setFrontmatter] = useState<ArticleFrontmatter>({
    ...initialState.frontmatter,
    status: "draft"
  });
  const [body, setBody] = useState(initialState.body);
  const [studioView, setStudioView] = useState<StudioView>(initialStudioView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<StudioSettingsMode>("metadata");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState(initialState.saveStatus);
  const [operationMessage, setOperationMessage] = useState<StudioNotificationMessage | null>(initialState.message);
  const [validationRequested, setValidationRequested] = useState(false);
  const [publicationIssues, setPublicationIssues] = useState<CmsEditorialIssue[]>([]);
  const [cmsSessionState, setCmsSessionState] = useState<CmsSessionState>({ kind: "checking" });
  const [cmsRefresh, setCmsRefresh] = useState(0);
  const [cmsArticles, setCmsArticles] = useState<CmsArticleSummary[]>([]);
  const [cmsAssets, setCmsAssets] = useState<CmsAsset[]>([]);
  const [cmsAssetsError, setCmsAssetsError] = useState<CmsClientError | null>(null);
  const [cmsSeries, setCmsSeries] = useState<CmsSeries[]>([]);
  const [cmsSeriesBusy, setCmsSeriesBusy] = useState(false);
  const [cmsSeriesError, setCmsSeriesError] = useState<string | null>(null);
  const [cmsArticleQuery, setCmsArticleQuery] = useState("");
  const [cmsArticleFilter, setCmsArticleFilter] = useState<CmsArticleFilter>("all");
  const [cmsArticle, setCmsArticle] = useState<CmsArticleDetail | null>(null);
  const [cmsReviewComments, setCmsReviewComments] = useState<CmsReviewComment[]>([]);
  const [cmsReviewCommentsBusy, setCmsReviewCommentsBusy] = useState(false);
  const [cmsReviewCommentBody, setCmsReviewCommentBody] = useState("");
  const [cmsReviewCommentTarget, setCmsReviewCommentTarget] = useState<CmsReviewCommentTarget>("article");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
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
  const [cmsPublishVisibility, setCmsPublishVisibility] = useState<CmsVisibility>("public");
  const [cmsSaveState, setCmsSaveState] = useState<CmsSaveState>(
    initialCmsRecoverySaveState(initialState.cmsReference)
  );
  const [cmsConflict, setCmsConflict] = useState(false);
  const [cmsConflictResolverOpen, setCmsConflictResolverOpen] = useState(false);
  const [cmsConflictLatestState, setCmsConflictLatestState] = useState<CmsConflictLatestState>({ kind: "idle" });
  const [cmsConflictRefresh, setCmsConflictRefresh] = useState(0);
  const [cmsOperationBusy, setCmsOperationBusy] = useState(false);
  const [lastCmsFingerprint, setLastCmsFingerprint] = useState<string | null>(null);
  const [cmsMembers, setCmsMembers] = useState<CmsMember[]>([]);
  const [cmsMembersBusy, setCmsMembersBusy] = useState(false);
  const [cmsMembersError, setCmsMembersError] = useState<string | null>(null);
  const [passwordMigrationBusy, setPasswordMigrationBusy] = useState(false);
  const [passwordMigrationError, setPasswordMigrationError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [cmsMemberEmail, setCmsMemberEmail] = useState("");
  const [cmsMemberRole, setCmsMemberRole] = useState<CmsRole>("editor");
  const [cmsMemberActive, setCmsMemberActive] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<"hero" | null>(null);
  const [assetTrayOpen, setAssetTrayOpen] = useState(false);
  const [sidePanelWidth, setSidePanelWidth] = useState(() => (
    typeof window === "undefined"
      ? defaultStudioPanelWidth
      : clampStudioPanelWidth(defaultStudioPanelWidth, window.innerWidth)
  ));
  const [assetDropActive, setAssetDropActive] = useState(false);
  const [assetOperationBusy, setAssetOperationBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const assetTrigger = useRef<HTMLButtonElement>(null);
  const versionHistoryTrigger = useRef<HTMLButtonElement>(null);
  const reviewCommentInput = useRef<HTMLTextAreaElement>(null);
  const validationSection = useRef<HTMLElement>(null);
  const cmsRecoveryReconnectInFlight = useRef<string | null>(null);
  const cmsSaveInFlight = useRef(false);
  const editSession = useRef(createCmsEditSession());
  const pendingRevisionReason = useRef<{
    reason: "conflict_resolution" | "restored";
    sourceRevisionId?: string;
  } | null>(null);
  const pendingViewFocus = useRef<string | null>(null);
  const studioViewRef = useRef(studioView);
  const cmsContentRef = useRef({ body, frontmatter, visibility: cmsVisibility });
  const manuallyEditedMetadata = useRef<Set<keyof ArticleFrontmatter>>(
    new Set(
      initialState.cmsReference || initialState.hasRecoveryDraft
        ? autoManagedMetadataFields
        : []
    )
  );
  const deferredBody = useDeferredValue(body);

  useEffect(() => {
    const fitSidePanelToViewport = () => {
      setSidePanelWidth((width) => clampStudioPanelWidth(width, window.innerWidth));
    };
    window.addEventListener("resize", fitSidePanelToViewport);
    return () => window.removeEventListener("resize", fitSidePanelToViewport);
  }, []);
  const showNotification = useCallback((message: StudioNotificationMessage) => {
    setOperationMessage((current) => (
      current?.text === message.text && current.tone === message.tone && current.title === message.title
        ? current
        : message
    ));
  }, []);

  useEffect(() => {
    if (!cmsConflict || !cmsArticle) {
      setCmsConflictLatestState({ kind: "idle" });
      return;
    }
    if (!cmsConflictResolverOpen) return;
    const controller = new AbortController();
    setCmsConflictLatestState({ kind: "loading" });
    void fetchCmsArticle(cmsArticle.id, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setCmsConflictLatestState(result.ok
        ? { article: result.value, kind: "ready" }
        : { error: result.error, kind: "error" });
    });
    return () => controller.abort();
  }, [cmsArticle?.id, cmsConflict, cmsConflictRefresh, cmsConflictResolverOpen]);
  const closeAssetTray = useCallback(() => {
    setAssetTrayOpen(false);
    window.requestAnimationFrame(() => assetTrigger.current?.focus());
  }, []);
  studioViewRef.current = studioView;
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
    cmsArticle &&
    !cmsAutosavePaused &&
    !cmsConflict &&
    lastCmsFingerprint === cmsContentFingerprint(draftFrontmatter, draftBody, cmsVisibility)
      ? clearDraft(storage)
      : saveDraft(storage, {
          frontmatter: draftFrontmatter,
          body: draftBody,
          ...(cmsDraftReference ? { cmsArticle: cmsDraftReference } : {}),
          ...(cmsAssociationRequired && !cmsDraftReference ? { cmsAssociation: "unknown" as const } : {})
        })
  ), [cmsArticle, cmsAssociationRequired, cmsAutosavePaused, cmsConflict, cmsDraftReference, cmsVisibility, lastCmsFingerprint, storage]);

  const previewSeries = useMemo(
    () => buildArticlePreviewSeries(cmsArticle?.id ?? null, frontmatter.title, cmsSeries),
    [cmsArticle?.id, cmsSeries, frontmatter.title]
  );
  const previewHtml = useMemo(
    () => DOMPurify.sanitize(renderArticlePresentation(frontmatter, deferredBody, {
      markdownRenderer: markdown,
      resolveImageReference: (reference) => resolvePreviewImageReference(reference, publicSiteUrl),
      resolveLinkReference: (reference) => resolvePublicSiteReference(reference, publicSiteUrl),
      series: previewSeries
    }), {
      ADD_ATTR: ["encoding", "target"],
      ADD_TAGS: ["annotation", "semantics"]
    }),
    [deferredBody, frontmatter, previewSeries]
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
  const contentReviewLocked = Boolean(
    cmsArticle && ["in_review", "approved"].includes(cmsArticle.reviewStatus)
  );
  const editorLocked =
    cmsSessionState.kind !== "ready" ||
    !cmsSessionState.session.capabilities.canEdit ||
    contentReviewLocked;
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
    setCmsSeriesError(null);
    void Promise.all([
      fetchCmsSession({ signal: controller.signal }),
      fetchCmsArticles({ signal: controller.signal }),
      fetchCmsAssets({ signal: controller.signal }),
      fetchCmsSeries({ signal: controller.signal })
    ]).then(([sessionResult, articlesResult, assetsResult, seriesResult]) => {
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
      if (seriesResult.ok) setCmsSeries(seriesResult.value);
      else setCmsSeriesError(seriesResult.error.message);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [cmsRefresh]);

  useEffect(() => {
    if (!cmsArticle) {
      setCmsReviewComments([]);
      setCmsReviewCommentsBusy(false);
      return;
    }
    const controller = new AbortController();
    setCmsReviewCommentsBusy(true);
    void fetchCmsReviewComments(cmsArticle.id, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setCmsReviewComments(result.value);
      else showNotification({
        text: result.error.message,
        title: "レビューコメントを読み込めません",
        tone: "error"
      });
      setCmsReviewCommentsBusy(false);
    });
    return () => controller.abort();
  }, [cmsArticle?.id, cmsArticle?.lockVersion, showNotification]);

  useEffect(() => {
    if (!operationMessage || operationMessage.tone === "error") return;
    const timer = window.setTimeout(() => setOperationMessage(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [operationMessage]);

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
        showNotification({
          text: "ブラウザに復旧コピーを保存できませんでした。Markdownを書き出して内容を保管してください。",
          title: "自動保存に失敗しました",
          tone: "error"
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [body, cmsArticle, editorLocked, frontmatter, saveBrowserDraft, showNotification, studioView]);

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
      studioView !== "editor" ||
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
        showNotification({
          text: "復旧コピーを元のCMS記事へ再接続できませんでした。内容は保持しています。もう一度確認するか、記事一覧から元の記事を開いてください。",
          title: "復旧原稿を再接続できません",
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
      if (recovery.conflict) {
        setOperationMessage(null);
      } else if (keepAutosavePaused) {
        showNotification({
          text: `「${article.title || "無題の記事"}」へ再接続しました。内容を確認し、「保存」でCMSへ反映してください。`,
          title: "保存前の確認が必要です",
          tone: "info"
        });
      }
      cmsRecoveryReconnectInFlight.current = null;
      setCmsOperationBusy(false);
    });

    return () => {
      current = false;
      controller.abort();
      if (cmsRecoveryReconnectInFlight.current === reference.id) {
        cmsRecoveryReconnectInFlight.current = null;
        setCmsOperationBusy(false);
      }
    };
  }, [cmsArticle, cmsAutosavePaused, cmsRecoveryReference, cmsSessionState, showNotification, storage, studioView, updateCmsArticleList]);

  const changeStudioView = (view: StudioView) => {
    if (studioViewRef.current !== view) writeStudioHistory(view);
    studioViewRef.current = view;
    setStudioView(view);
  };

  const showEditor = () => {
    pendingViewFocus.current = "editor-heading";
    changeStudioView("editor");
    setSettingsOpen(false);
    setPreviewFullscreen(false);
    setAssetTrayOpen(false);
  };

  const showArticleLibrary = () => {
    setOperationMessage(null);
    if (hasMeaningfulArticleInput(frontmatter, body)) {
      const result = saveBrowserDraft(frontmatter, body);
      if (!cmsArticle && !cmsRecoveryReference) setHasRecoveryDraft(true);
      setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
      if (!result.ok) {
        showNotification({
          text: "復旧コピーを保存できませんでした。内容はこの画面を閉じるまで保持しています。",
          title: "自動保存に失敗しました",
          tone: "error"
        });
      }
    }
    pendingViewFocus.current = "studio-article-library-heading";
    changeStudioView("articles");
  };

  const showAssetLibrary = () => {
    setOperationMessage(null);
    if (hasMeaningfulArticleInput(frontmatter, body)) saveBrowserDraft(frontmatter, body);
    pendingViewFocus.current = "studio-asset-library-heading";
    changeStudioView("assets");
    setSettingsOpen(false);
    setPreviewFullscreen(false);
    setAssetTrayOpen(false);
  };

  const showTeamSettings = () => {
    setOperationMessage(null);
    if (hasMeaningfulArticleInput(frontmatter, body)) saveBrowserDraft(frontmatter, body);
    pendingViewFocus.current = "studio-team-heading";
    changeStudioView("team");
    setSettingsOpen(false);
    setPreviewFullscreen(false);
  };

  useEffect(() => {
    writeStudioHistory(initialStudioView, "replace");
  }, [initialStudioView]);

  useEffect(() => {
    const restoreStudioView = () => {
      const nextView = readStudioView(window.location.pathname);
      if (studioViewRef.current === "editor" && nextView !== "editor") {
        const current = cmsContentRef.current;
        if (hasMeaningfulArticleInput(current.frontmatter, current.body)) {
          const result = saveBrowserDraft(current.frontmatter, current.body);
          if (result.ok && !cmsArticle && !cmsRecoveryReference) setHasRecoveryDraft(true);
          setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
          if (!result.ok) {
            showNotification({
              text: "復旧コピーを保存できませんでした。内容はこの画面を閉じるまで保持しています。",
              title: "自動保存に失敗しました",
              tone: "error"
            });
          }
        }
      }
      setOperationMessage(null);
      setSettingsOpen(false);
      setPreviewFullscreen(false);
      setAssetTrayOpen(false);
      pendingViewFocus.current = nextView === "articles"
        ? "studio-article-library-heading"
        : nextView === "assets"
          ? "studio-asset-library-heading"
          : nextView === "team"
            ? "studio-team-heading"
            : "editor-heading";
      studioViewRef.current = nextView;
      setStudioView(nextView);
    };
    window.addEventListener("popstate", restoreStudioView);
    return () => window.removeEventListener("popstate", restoreStudioView);
  }, [cmsArticle, cmsRecoveryReference, saveBrowserDraft, showNotification]);

  const applyCmsArticle = (
    article: CmsArticleDetail,
    options: {
      pauseAutosave?: boolean;
      preserveLocalInput?: boolean;
      preserveLocalVisibility?: boolean;
    } = {}
  ) => {
    editSession.current = createCmsEditSession();
    pendingRevisionReason.current = null;
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
    setCmsPublishVisibility(article.publishedVisibility ?? article.visibility);
    setLastCmsFingerprint(serverFingerprint);
    setCmsSaveState(preservedInputHasChanges ? "dirty" : "saved");
    setCmsAutosavePaused(manualSaveRequired);
    setCmsConflict(false);
    setCmsConflictResolverOpen(false);
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
    if (cmsOperationBusy || cmsSaveInFlight.current) return false;
    if (articleId === cmsRecoveryReference?.id) {
      showEditor();
      return true;
    }
    if (articleId === cmsArticle?.id) {
      showEditor();
      if (editorLocked) {
        setSettingsMode(
          cmsSession?.capabilities.canPublish && cmsArticle.reviewStatus === "approved"
            ? "publish"
            : "review"
        );
        setSettingsOpen(true);
        setPreviewFullscreen(true);
      }
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
      const targetLocked =
        cmsSessionState.kind !== "ready" ||
        !cmsSessionState.session.capabilities.canEdit ||
        ["in_review", "approved"].includes(result.value.reviewStatus);
      if (targetLocked) {
        setSettingsMode(
          cmsSessionState.kind === "ready" &&
          cmsSessionState.session.capabilities.canPublish &&
          result.value.reviewStatus === "approved"
            ? "publish"
            : "review"
        );
        setSettingsOpen(true);
        setPreviewFullscreen(true);
      }
      if (associatingRecovery && application.manualSaveRequired) {
        showNotification({
          text: `復旧原稿を「${result.value.title || "無題の記事"}」に引き継ぎました。内容を確認し、「保存」でCMSへ反映してください。`,
          title: "保存前の確認が必要です",
          tone: "info"
        });
      }
    } else {
      showNotification({ text: result.error.message, tone: "error" });
    }
    setCmsOperationBusy(false);
    setOpeningArticleId(null);
    return result.ok;
  };

  const saveCmsDraft = useCallback(async (
    requestedReason: "autosave" | "manual" = "manual"
  ): Promise<CmsArticleDetail | null> => {
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
    editSession.current = ensureActiveCmsEditSession(editSession.current);
    const pendingReason = pendingRevisionReason.current;
    const revisionContext = {
      editSessionId: editSession.current.id,
      saveReason: pendingReason?.reason ?? requestedReason,
      ...(pendingReason?.sourceRevisionId
        ? { sourceRevisionId: pendingReason.sourceRevisionId }
        : {})
    } as const;
    const draftFrontmatter: ArticleFrontmatter = {
      ...snapshot.frontmatter,
      status: "draft"
    };
    const snapshotFingerprint = cmsContentFingerprint(
      draftFrontmatter,
      snapshot.body,
      snapshot.visibility
    );
    let savedDraft: CmsDraftContent = {
      body: snapshot.body,
      frontmatter: draftFrontmatter,
      visibility: snapshot.visibility
    };
    let savedReason = revisionContext.saveReason;
    let automaticallyMerged = false;
    cmsSaveInFlight.current = true;
    setCmsSaveState("saving");
    let result = cmsArticle
      ? await updateCmsArticleRecord(
          cmsArticle.id,
          cmsArticle.lockVersion,
          {
            frontmatter: draftFrontmatter,
            markdown: snapshot.body,
            visibility: snapshot.visibility
          },
          {},
          revisionContext
        )
      : await createCmsArticleRecord({
          frontmatter: draftFrontmatter,
          markdown: snapshot.body,
          visibility: snapshot.visibility
        }, {}, { editSessionId: editSession.current.id });

    if (!result.ok && result.error.code === "revision_conflict" && cmsArticle) {
      const baseArticle = cmsArticle;
      const latestResult = await fetchCmsArticle(baseArticle.id);
      if (latestResult.ok) {
        const latestArticle = latestResult.value;
        const merge = mergeCmsDraftOntoLatest({
          base: {
            body: baseArticle.currentRevision.markdown,
            frontmatter: { ...baseArticle.currentRevision.frontmatter, status: "draft" },
            visibility: baseArticle.visibility
          },
          latest: {
            body: latestArticle.currentRevision.markdown,
            frontmatter: { ...latestArticle.currentRevision.frontmatter, status: "draft" },
            visibility: latestArticle.visibility
          },
          local: savedDraft
        });

        if (merge.kind === "merged") {
          savedDraft = {
            ...merge.draft,
            frontmatter: { ...merge.draft.frontmatter, status: "draft" }
          };
          savedReason = "conflict_resolution";
          automaticallyMerged = true;
          result = await updateCmsArticleRecord(
            latestArticle.id,
            latestArticle.lockVersion,
            {
              frontmatter: savedDraft.frontmatter,
              markdown: savedDraft.body,
              visibility: savedDraft.visibility
            },
            {},
            { ...revisionContext, saveReason: "conflict_resolution" }
          );
        } else {
          const inFlight = cmsContentRef.current;
          const inFlightFingerprint = cmsContentFingerprint(
            { ...inFlight.frontmatter, status: "draft" },
            inFlight.body,
            inFlight.visibility
          );
          const visibleDraft = inFlightFingerprint === snapshotFingerprint
            ? merge.draft
            : mergeCmsDraftOntoLatest({
                base: {
                  body: snapshot.body,
                  frontmatter: draftFrontmatter,
                  visibility: snapshot.visibility
                },
                latest: merge.draft,
                local: {
                  ...inFlight,
                  frontmatter: { ...inFlight.frontmatter, status: "draft" }
                }
              }).draft;
          const latestFingerprint = cmsContentFingerprint(
            { ...latestArticle.currentRevision.frontmatter, status: "draft" },
            latestArticle.currentRevision.markdown,
            latestArticle.visibility
          );
          setCmsArticle(latestArticle);
          setFrontmatter({ ...visibleDraft.frontmatter, status: "draft" });
          setBody(visibleDraft.body);
          setCmsVisibility(visibleDraft.visibility);
          setLastCmsFingerprint(latestFingerprint);
          setCmsConflict(true);
          setCmsConflictResolverOpen(false);
          setCmsConflictLatestState({ article: latestArticle, kind: "ready" });
          setCmsSaveState("conflict");
          setCmsAutosavePaused(true);
          setCmsRecoveryReference({
            autosavePaused: true,
            id: latestArticle.id,
            lockVersion: baseArticle.lockVersion,
            visibility: visibleDraft.visibility
          });
          updateCmsArticleList(latestArticle);
          saveDraft(storage, {
            frontmatter: visibleDraft.frontmatter,
            body: visibleDraft.body,
            cmsArticle: {
              autosavePaused: true,
              id: latestArticle.id,
              lockVersion: baseArticle.lockVersion,
              visibility: visibleDraft.visibility
            }
          });
          cmsSaveInFlight.current = false;
          setOperationMessage(null);
          return null;
        }
      }
    }

    cmsSaveInFlight.current = false;
    if (!result.ok) {
      if (result.error.code === "revision_conflict") {
        setCmsConflict(true);
        setCmsConflictResolverOpen(false);
        setCmsSaveState("conflict");
        setCmsAutosavePaused(true);
        if (cmsArticle) {
          setCmsRecoveryReference({
            autosavePaused: true,
            id: cmsArticle.id,
            lockVersion: cmsArticle.lockVersion,
            visibility: snapshot.visibility
          });
          saveDraft(storage, {
            frontmatter: draftFrontmatter,
            body: snapshot.body,
            cmsArticle: {
              autosavePaused: true,
              id: cmsArticle.id,
              lockVersion: cmsArticle.lockVersion,
              visibility: snapshot.visibility
            }
          });
        }
        setOperationMessage(null);
      } else {
        setCmsSaveState("error");
        showNotification({ text: result.error.message, tone: "error" });
      }
      return null;
    }

    const savedFingerprint = cmsContentFingerprint(
      savedDraft.frontmatter,
      savedDraft.body,
      savedDraft.visibility
    );
    const current = cmsContentRef.current;
    const currentFingerprint = cmsContentFingerprint(
      current.frontmatter,
      current.body,
      current.visibility
    );
    let visibleDraft = current;
    let hasNewerLocalChanges = currentFingerprint !== snapshotFingerprint;
    let needsFollowupReview = false;
    if (automaticallyMerged) {
      if (hasNewerLocalChanges) {
        const followup = mergeCmsDraftOntoLatest({
          base: {
            body: snapshot.body,
            frontmatter: draftFrontmatter,
            visibility: snapshot.visibility
          },
          latest: savedDraft,
          local: current
        });
        visibleDraft = followup.draft;
        needsFollowupReview = followup.kind === "conflict";
        hasNewerLocalChanges = true;
      } else {
        visibleDraft = savedDraft;
      }
      setFrontmatter({ ...visibleDraft.frontmatter, status: "draft" });
      setBody(visibleDraft.body);
      setCmsVisibility(visibleDraft.visibility);
    }

    setCmsArticle(result.value);
    setCmsRecoveryReference(needsFollowupReview ? {
      autosavePaused: true,
      id: result.value.id,
      lockVersion: result.value.lockVersion,
      visibility: visibleDraft.visibility
    } : null);
    setCmsAssociationRequired(false);
    setCmsAutosavePaused(needsFollowupReview);
    setHasRecoveryDraft(false);
    setCmsConflict(needsFollowupReview);
    setCmsConflictResolverOpen(false);
    setCmsConflictLatestState(needsFollowupReview
      ? { article: result.value, kind: "ready" }
      : { kind: "idle" });
    updateCmsArticleList(result.value);
    setLastCmsFingerprint(savedFingerprint);
    if (needsFollowupReview || hasNewerLocalChanges) {
      saveDraft(storage, {
        frontmatter: visibleDraft.frontmatter,
        body: visibleDraft.body,
        cmsArticle: {
          ...(needsFollowupReview ? { autosavePaused: true as const } : {}),
          id: result.value.id,
          lockVersion: result.value.lockVersion,
          visibility: visibleDraft.visibility
        }
      });
    } else clearDraft(storage);
    setCmsSaveState(needsFollowupReview ? "conflict" : hasNewerLocalChanges ? "dirty" : "saved");
    editSession.current = completeCmsEditSessionSave(
      editSession.current,
      savedReason
    );
    pendingRevisionReason.current = null;
    if (automaticallyMerged) {
      if (needsFollowupReview) {
        setOperationMessage(null);
      } else showNotification({
        text: hasNewerLocalChanges
          ? "CMS最新版へ統合しました。保存中に続けた入力は次の自動保存で反映します。"
          : `CMS revision ${result.value.revisionNumber}として自動統合しました。`,
        title: "CMS最新版へ反映しました",
        tone: "info"
      });
    }
    return result.value;
  }, [cmsArticle, cmsAssociationRequired, cmsConflict, cmsRecoveryReference, cmsSessionState, editorLocked, showNotification, storage, updateCmsArticleList]);

  const continueRecoveryAsNewArticle = () => {
    setCmsAssociationRequired(false);
    setCmsAutosavePaused(false);
    const result = saveDraft(storage, { frontmatter, body });
    setSaveStatus(result.ok ? "ブラウザに復旧コピーを保存済み" : "復旧コピーを保存できません");
    showEditor();
    if (!result.ok) {
      showNotification({
        text: "新しい記事として続けますが、復旧コピーを保存できません。Markdownを書き出して保管してください。",
        title: "自動保存に失敗しました",
        tone: "error"
      });
    }
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
    setCmsConflictResolverOpen(false);
    editSession.current = createCmsEditSession();
    pendingRevisionReason.current = null;
    setPublicationIssues([]);
    setValidationRequested(false);
    manuallyEditedMetadata.current.clear();
    showEditor();
  };

  const applyConflictResolution = async (draft: ResolvedCmsConflictDraft) => {
    if (cmsConflictLatestState.kind !== "ready") return;
    const article = cmsConflictLatestState.article;
    const latestFrontmatter: ArticleFrontmatter = {
      ...article.currentRevision.frontmatter,
      status: "draft"
    };
    const nextFrontmatter: ArticleFrontmatter = { ...draft.frontmatter, status: "draft" };
    const serverFingerprint = cmsContentFingerprint(
      latestFrontmatter,
      article.currentRevision.markdown,
      article.visibility
    );
    const resolvedFingerprint = cmsContentFingerprint(nextFrontmatter, draft.body, draft.visibility);

    if (resolvedFingerprint === serverFingerprint) {
      applyCmsArticle(article);
      setCmsConflictLatestState({ kind: "idle" });
      showNotification({
        text: `CMS revision ${article.revisionNumber}を開きました。ブラウザ側の入力はCMSへ保存していません。`,
        title: "CMS最新版を採用しました",
        tone: "info"
      });
      return;
    }

    setCmsOperationBusy(true);
    const resolutionSession = createCmsEditSession();
    const result = await updateCmsArticleRecord(
      article.id,
      article.lockVersion,
      {
        frontmatter: nextFrontmatter,
        markdown: draft.body,
        visibility: draft.visibility
      },
      {},
      { editSessionId: resolutionSession.id, saveReason: "conflict_resolution" }
    );
    setCmsOperationBusy(false);

    if (result.ok) {
      const savedFingerprint = cmsContentFingerprint(
        { ...result.value.currentRevision.frontmatter, status: "draft" },
        result.value.currentRevision.markdown,
        result.value.visibility
      );
      setCmsArticle(result.value);
      setFrontmatter({ ...result.value.currentRevision.frontmatter, status: "draft" });
      setBody(result.value.currentRevision.markdown);
      setCmsVisibility(result.value.visibility);
      setLastCmsFingerprint(savedFingerprint);
      setCmsSaveState("saved");
      setCmsAutosavePaused(false);
      editSession.current = completeCmsEditSessionSave(resolutionSession, "conflict_resolution");
      pendingRevisionReason.current = null;
      setCmsConflict(false);
      setCmsConflictResolverOpen(false);
      setCmsConflictLatestState({ kind: "idle" });
      setCmsRecoveryReference(null);
      setCmsAssociationRequired(false);
      setHasRecoveryDraft(false);
      setPublicationIssues([]);
      setValidationRequested(false);
      manuallyEditedMetadata.current = new Set(autoManagedMetadataFields);
      updateCmsArticleList(result.value);
      clearDraft(storage);
      setSaveStatus("CMSに保存済み");
      showNotification({
        text: `CMS revision ${result.value.revisionNumber}として保存しました。必要なら履歴から元の版へ戻せます。`,
        title: "競合を解消して保存しました",
        tone: "info"
      });
      return;
    }

    setCmsArticle(article);
    setFrontmatter(nextFrontmatter);
    setBody(draft.body);
    setCmsVisibility(draft.visibility);
    setLastCmsFingerprint(serverFingerprint);
    setCmsSaveState(result.error.code === "revision_conflict" ? "conflict" : "error");
    setCmsAutosavePaused(true);
    editSession.current = resolutionSession;
    pendingRevisionReason.current = { reason: "conflict_resolution" };
    setCmsConflict(true);
    setCmsConflictResolverOpen(false);
    setCmsConflictLatestState({ kind: "idle" });
    setCmsRecoveryReference({
      autosavePaused: true,
      id: article.id,
      lockVersion: article.lockVersion,
      visibility: draft.visibility
    });
    setCmsAssociationRequired(false);
    setHasRecoveryDraft(false);
    setPublicationIssues([]);
    setValidationRequested(false);
    manuallyEditedMetadata.current = new Set(autoManagedMetadataFields);
    updateCmsArticleList(article);
    setSaveStatus("統合結果をブラウザに保持中");
    saveDraft(storage, {
      frontmatter: nextFrontmatter,
      body: draft.body,
      cmsArticle: {
        autosavePaused: true,
        id: article.id,
        lockVersion: article.lockVersion,
        visibility: draft.visibility
      }
    });
    showNotification({
      text: `${result.error.message} 選んだ内容はブラウザに保持しています。もう一度、変更の確認から保存できます。`,
      title: "統合結果をCMSへ保存できませんでした",
      tone: "error"
    });
  };

  const useLatestConflictArticle = (article: CmsArticleDetail) => {
    if (!window.confirm(
      `ブラウザ側の入力を破棄してCMS revision ${article.revisionNumber}を開きますか？ 必要なら先にMarkdownを書き出してください。`
    )) return;
    applyCmsArticle(article);
    setCmsConflictResolverOpen(false);
    setCmsConflictLatestState({ kind: "idle" });
    showNotification({
      text: `CMS revision ${article.revisionNumber}を開きました。`,
      title: "CMS最新版を採用しました",
      tone: "info"
    });
  };

  const runCmsAction = async (action: CmsArticleAction) => {
    if (cmsAutosavePaused) {
      showNotification({
        text: "復旧内容を確認し、先に「保存」でCMSへ反映してください。保存後にレビューまたは公開の操作を続けられます。",
        title: "先に保存してください",
        tone: "info"
      });
      return;
    }
    if (
      cmsSessionState.kind !== "ready" ||
      cmsOperationBusy ||
      cmsSaveInFlight.current ||
      (action === "request_review" && editorLocked)
    ) return;
    let target = cmsArticle;
    if (!target || (action === "request_review" && cmsDirty)) target = await saveCmsDraft();
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
    if (action === "request_review" && latestFingerprint !== savedFingerprint) {
      setCmsSaveState("dirty");
      showNotification({
        text: "保存中に新しい変更がありました。自動保存の完了後、もう一度ワークフロー操作を選んでください。",
        title: "新しい変更が残っています",
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
        focusValidation();
        return;
      }
    }

    let note: string | undefined;
    if (action === "request_changes") {
      note = cmsReviewCommentBody.trim().slice(0, 500) || undefined;
      if (!note) {
        showNotification({
          text: "修正してほしい内容をコメント欄へ入力してください。",
          title: "修正理由が必要です",
          tone: "info"
        });
        reviewCommentInput.current?.focus();
        return;
      }
    }

    if (action === "revoke_approval" && !window.confirm(
      cmsArticle?.publicationStatus === "published"
        ? "承認を取り消してレビュー中へ戻しますか？ 現在公開中の内容はそのまま維持されます。"
        : "承認を取り消してレビュー中へ戻しますか？"
    )) return;
    if (action === "publish" && !window.confirm(
      `「${target.title || "無題の記事"}」のrevision ${target.revisionNumber}を${cmsVisibilityLabels[cmsPublishVisibility]}で公開しますか？`
    )) return;

    const actionStartFingerprint = latestFingerprint;
    setCmsOperationBusy(true);
    const result = await runCmsArticleAction(
      target.id,
      target.lockVersion,
      action,
      {
        ...(note ? { note } : {}),
        ...(action === "publish" ? { visibility: cmsPublishVisibility } : {})
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
        revoke_approval: "承認を取り消し、レビュー中へ戻しました。",
        request_changes: "修正を依頼しました。",
        request_review: "レビューを依頼しました。",
        restore: "記事を未公開へ戻しました。",
        withdraw_review: "レビューを取り下げ、編集できる状態へ戻しました。"
      };
      if (action === "approve" && cmsSessionState.session.capabilities.canPublish) {
        setSettingsMode("publish");
      }
      if (action === "revoke_approval") setSettingsMode("review");
      if (action === "request_changes") setCmsReviewCommentBody("");
      if (localChangedDuringAction) {
        showNotification({
          text: `${labels[action]} 操作中に入力した変更は未保存のまま保持しています。`,
          title: "未保存の変更があります",
          tone: "info"
        });
      }
    } else if (result.error.code === "revision_conflict") {
      const latestResult = await fetchCmsArticle(target.id);
      if (latestResult.ok) {
        const latestArticle = latestResult.value;
        const current = cmsContentRef.current;
        const merge = mergeCmsDraftOntoLatest({
          base: {
            body: target.currentRevision.markdown,
            frontmatter: { ...target.currentRevision.frontmatter, status: "draft" },
            visibility: target.visibility
          },
          latest: {
            body: latestArticle.currentRevision.markdown,
            frontmatter: { ...latestArticle.currentRevision.frontmatter, status: "draft" },
            visibility: latestArticle.visibility
          },
          local: current
        });
        const latestFingerprint = cmsContentFingerprint(
          { ...latestArticle.currentRevision.frontmatter, status: "draft" },
          latestArticle.currentRevision.markdown,
          latestArticle.visibility
        );
        const mergedFingerprint = cmsContentFingerprint(
          merge.draft.frontmatter,
          merge.draft.body,
          merge.draft.visibility
        );
        setCmsArticle(latestArticle);
        setFrontmatter({ ...merge.draft.frontmatter, status: "draft" });
        setBody(merge.draft.body);
        setCmsVisibility(merge.draft.visibility);
        setLastCmsFingerprint(latestFingerprint);
        updateCmsArticleList(latestArticle);
        setCmsConflict(merge.kind === "conflict");
        setCmsConflictResolverOpen(false);
        setCmsConflictLatestState(merge.kind === "conflict"
          ? { article: latestArticle, kind: "ready" }
          : { kind: "idle" });
        setCmsAutosavePaused(merge.kind === "conflict");
        setCmsRecoveryReference(merge.kind === "conflict" ? {
          autosavePaused: true,
          id: latestArticle.id,
          lockVersion: target.lockVersion,
          visibility: merge.draft.visibility
        } : null);
        setCmsSaveState(merge.kind === "conflict"
          ? "conflict"
          : mergedFingerprint === latestFingerprint ? "saved" : "dirty");
        saveDraft(storage, {
          frontmatter: merge.draft.frontmatter,
          body: merge.draft.body,
          cmsArticle: {
            ...(merge.kind === "conflict" ? { autosavePaused: true as const } : {}),
            id: latestArticle.id,
            lockVersion: merge.kind === "conflict" ? target.lockVersion : latestArticle.lockVersion,
            visibility: merge.draft.visibility
          }
        });
        if (merge.kind === "conflict") setOperationMessage(null);
        else showNotification({
          text: "CMS最新版へ更新しました。内容を確認してから、ワークフロー操作をもう一度選んでください。",
          title: "最新版を反映しました",
          tone: "info"
        });
      } else {
        setCmsConflict(true);
        setCmsConflictResolverOpen(false);
        setCmsSaveState("conflict");
        setCmsAutosavePaused(true);
        setOperationMessage(null);
      }
    } else {
      if (result.error.issues) {
        setPublicationIssues(normalizeReviewIssues(result.error.issues));
        setValidationRequested(true);
      }
      if (result.error.issues) focusValidation();
      else showNotification({ text: result.error.message, tone: "error" });
    }
    setCmsOperationBusy(false);
  };

  const addCmsReviewComment = async () => {
    if (!cmsArticle || !cmsSession?.capabilities.canComment || cmsOperationBusy) return;
    const commentBody = cmsReviewCommentBody.trim();
    if (!commentBody) {
      reviewCommentInput.current?.focus();
      return;
    }
    setCmsOperationBusy(true);
    const result = await createCmsReviewCommentRecord(cmsArticle.id, {
      body: commentBody,
      target: cmsReviewCommentTarget
    });
    if (result.ok) {
      setCmsReviewComments((current) => [...current, result.value]);
      setCmsReviewCommentBody("");
      showNotification({
        text: `revision ${result.value.revisionNumber}へコメントを追加しました。`,
        title: "コメントを追加しました",
        tone: "info"
      });
    } else {
      showNotification({
        text: result.error.message,
        title: "コメントを追加できません",
        tone: "error"
      });
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
    } else {
      setCmsMembersError(result.error.message);
    }
    setCmsMembersBusy(false);
  };

  const saveCmsSeries = async (
    current: CmsSeries | null,
    content: CmsSeriesContent,
    restoredFromRevisionId?: string
  ): Promise<CmsSeries | null> => {
    if (cmsSessionState.kind !== "ready" || !cmsSessionState.session.capabilities.canEdit) return null;
    setCmsSeriesBusy(true);
    setCmsSeriesError(null);
    const result = current
      ? await updateCmsSeriesRecord(
          current.id,
          current.lockVersion,
          content,
          restoredFromRevisionId
        )
      : await createCmsSeriesRecord(content);
    setCmsSeriesBusy(false);
    if (!result.ok) {
      setCmsSeriesError(result.error.message);
      showNotification({ text: result.error.message, title: "シリーズを保存できませんでした", tone: "error" });
      return null;
    }
    setCmsSeries((items) => [result.value, ...items.filter((item) => item.id !== result.value.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    showNotification({
      text: restoredFromRevisionId
        ? `revision ${result.value.revisionNumber}として復元し、公開ナビゲーションへ反映しました。`
        : `revision ${result.value.revisionNumber}として公開ナビゲーションへ反映しました。`,
      title: restoredFromRevisionId ? "シリーズを復元しました" : "シリーズを保存しました",
      tone: "info"
    });
    return result.value;
  };

  const loadCmsSeriesHistory = async (seriesId: string): Promise<CmsSeriesVersion[]> => {
    const result = await fetchCmsSeriesVersions(seriesId);
    if (result.ok) return result.value;
    setCmsSeriesError(result.error.message);
    showNotification({ text: result.error.message, title: "シリーズ履歴を読み込めませんでした", tone: "error" });
    return [];
  };

  const configurePasswordLogin = async (password: string) => {
    if (cmsSessionState.kind !== "ready" || cmsSessionState.session.passwordLoginReadyAt) return;
    setPasswordMigrationBusy(true);
    setPasswordMigrationError(null);
    const result = await configureStudioPassword(password);
    if (result.ok) {
      showNotification({
        text: "Noemaのパスワードを設定しました。移行確認が終わるまではメールコードも利用できます。",
        title: "パスワード設定が完了しました",
        tone: "info"
      });
      setCmsRefresh((current) => current + 1);
    } else {
      setPasswordMigrationError(result.error.message);
    }
    setPasswordMigrationBusy(false);
  };

  const login = async (email: string, password: string) => {
    setLoginBusy(true);
    setLoginError(null);
    const result = await signInStudio(email, password);
    if (result.ok) setCmsRefresh((current) => current + 1);
    else setLoginError(result.error.message);
    setLoginBusy(false);
  };

  useEffect(() => {
    if (
      !cmsArticle ||
      !cmsDirty ||
      cmsConflict ||
      cmsAutosavePaused ||
      versionHistoryOpen ||
      editorLocked ||
      cmsSaveState === "saving" ||
      cmsSaveState === "error" ||
      cmsSessionState.kind !== "ready" ||
      !cmsSessionState.session.capabilities.canEdit
    ) return;
    const timer = window.setTimeout(() => {
      void saveCmsDraft("autosave");
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
    saveCmsDraft,
    versionHistoryOpen
  ]);

  const closeVersionHistory = () => {
    setVersionHistoryOpen(false);
    window.requestAnimationFrame(() => versionHistoryTrigger.current?.focus());
  };

  const openVersionHistory = async () => {
    if (cmsDirty && !cmsAutosavePaused && !cmsConflict) {
      const saved = await saveCmsDraft("manual");
      if (!saved) return;
    }
    setVersionHistoryOpen(true);
  };

  const restoreCmsVersion = (version: CmsArticleVersionDetail) => {
    if (!cmsArticle) return;
    const nextFrontmatter = { ...version.revision.frontmatter, status: "draft" as const };
    const nextVisibility = version.visibility ?? cmsVisibility;
    setFrontmatter(nextFrontmatter);
    setBody(version.revision.markdown);
    setCmsVisibility(nextVisibility);
    setCmsAutosavePaused(true);
    setCmsSaveState("dirty");
    setPublicationIssues([]);
    setValidationRequested(false);
    editSession.current = createCmsEditSession();
    pendingRevisionReason.current = {
      reason: "restored",
      sourceRevisionId: version.revision.id
    };
    manuallyEditedMetadata.current = new Set(autoManagedMetadataFields);
    saveDraft(storage, {
      body: version.revision.markdown,
      frontmatter: nextFrontmatter,
      cmsArticle: {
        autosavePaused: true,
        id: cmsArticle.id,
        lockVersion: cmsArticle.lockVersion,
        visibility: nextVisibility
      }
    });
    setVersionHistoryOpen(false);
    setSettingsOpen(false);
    showNotification({
      text: `revision ${version.revision.number}を編集画面へ戻しました。内容を確認し、「保存」で新しい版として記録してください。`,
      title: "過去の版はまだ保存されていません",
      tone: "info"
    });
    window.requestAnimationFrame(() => bodyInput.current?.focus());
  };

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
    for (const file of files) {
      const result = await uploadCmsAsset(file);
      if (!result.ok) {
        showNotification({ text: `${file.name}: ${result.error.message}`, title: "画像を追加できませんでした", tone: "error" });
        setAssetOperationBusy(false);
        return;
      }
      setCmsAssets((current) => [result.value, ...current.filter((asset) => asset.id !== result.value.id)]);
    }
    setCmsAssetsError(null);
    setAssetOperationBusy(false);
  };

  const saveAsset = async (
    asset: CmsAsset,
    input: { alt: string; status: CmsAssetStatus; tags: string[] }
  ) => {
    setAssetOperationBusy(true);
    const result = await updateCmsAssetRecord(asset.id, input);
    setAssetOperationBusy(false);
    if (!result.ok) {
      showNotification({ text: result.error.message, title: "画像情報を保存できませんでした", tone: "error" });
      return;
    }
    setCmsAssets((current) => current.map((item) => item.id === result.value.id ? result.value : item));
  };

  const deleteAsset = async (asset: CmsAsset) => {
    setAssetOperationBusy(true);
    const result = await deleteCmsAssetRecord(asset.id);
    setAssetOperationBusy(false);
    if (!result.ok) {
      showNotification({ text: result.error.message, title: "画像を削除できませんでした", tone: "error" });
      return;
    }
    setCmsAssets((current) => current.filter((item) => item.id !== asset.id));
    showNotification({ text: `${asset.originalName}をR2から削除しました。`, title: "画像を完全に削除しました", tone: "info" });
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
    update("heroImage", { alt: safeAlt, src: asset.markdownUrl });
    setAssetPickerTarget(null);
    setMediaOpen(true);
  };

  const insertBodyAsset = (asset: CmsAsset) => {
    const safeAlt = asset.alt.trim().replace(/[\[\]]/g, "");
    if (!safeAlt) return;
    insertMarkdownAtCursor(`![${safeAlt}](${asset.markdownUrl})`);
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
    } catch (error) {
      showNotification({
        text: error instanceof Error ? error.message : "Markdownを読み込めませんでした。",
        title: "Markdownを読み込めませんでした",
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
  const recoveryArticleSummary = cmsRecoveryReference
    ? cmsArticles.find((article) => article.id === cmsRecoveryReference.id) ?? null
    : null;
  const recoveryNeedsConflictCheck = cmsRecoveryNeedsConflictCheck(
    cmsRecoveryReference,
    recoveryArticleSummary?.lockVersion ?? null
  );
  const cmsSaveLabel: Record<CmsSaveState, string> = {
    conflict: "最新版と要確認・入力内容を保護中",
    dirty: "未保存の変更あり",
    error: "CMS保存に失敗",
    local: "新規原稿・未登録",
    saved: cmsArticle ? `CMS revision ${cmsArticle.revisionNumber} 保存済み` : "CMS保存済み",
    saving: "CMSへ保存中…"
  };
  const cmsCompactSaveLabel: Record<CmsSaveState, string> = {
    conflict: "要確認",
    dirty: "未保存",
    error: "保存失敗",
    local: "未登録",
    saved: cmsArticle ? `保存済み · r${cmsArticle.revisionNumber}` : "保存済み",
    saving: "保存中…"
  };
  const effectiveCmsSaveState: CmsSaveState = cmsDirty && cmsSaveState === "saved"
    ? "dirty"
    : cmsSaveState;
  const cmsWorkingArticleTitle = frontmatter.title || cmsArticle?.title || "編集中の記事";
  const cmsLibraryWorkingStatus: { text: string; tone: "error" | "info" } | null = cmsRecoveryReference
    ? {
        text: studioView !== "editor"
          ? recoveryNeedsConflictCheck
            ? `「${cmsWorkingArticleTitle}」にはCMS側の新しい変更があります。編集画面で最新版への反映を続けてください。`
            : `「${cmsWorkingArticleTitle}」の未反映内容があります。CMS最新版と比較して編集を再開できます。`
          : cmsConflict
          ? `「${cmsWorkingArticleTitle}」には同じ箇所への変更があります。入力内容はブラウザに保持しています。`
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
                ? `「${cmsWorkingArticleTitle}」には確認が必要な変更があります。入力内容はブラウザに保持しています。`
                : `「${cmsWorkingArticleTitle}」をCMSへ保存できませんでした。入力内容はブラウザに保持しています。`,
          tone: ["error", "conflict"].includes(effectiveCmsSaveState) ? "error" : "info"
        }
      : null;
  const cmsCanRequestReview = Boolean(
    cmsSession?.capabilities.canEdit &&
    cmsArticle && ["draft", "changes_requested"].includes(cmsArticle.reviewStatus)
  );
  const cmsCanWithdrawReview = Boolean(
    cmsSession?.capabilities.canEdit && cmsArticle?.reviewStatus === "in_review"
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
  const cmsCanRevokeApproval = Boolean(
    cmsSession?.capabilities.canApprove &&
    cmsArticle?.reviewStatus === "approved" &&
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
    ["public", "unlisted"].includes(cmsPublishVisibility) &&
    !cmsDirty
  );
  const cmsWorkflowShortcut = getCmsWorkflowShortcut(
    cmsArticle?.reviewStatus ?? null,
    Boolean(cmsSession?.capabilities.canPublish)
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
  const cmsEditorStatusDetails = cmsSessionState.kind === "checking"
    ? "CMSを確認中…"
    : cmsSessionState.kind === "unavailable"
      ? "CMSに接続できません"
      : cmsAssociationRequired
        ? "保存先を選択してください"
        : cmsSaveLabel[effectiveCmsSaveState];
  const cmsEditorStatus = cmsSessionState.kind === "checking"
    ? "確認中…"
    : cmsSessionState.kind === "unavailable"
      ? "接続エラー"
      : cmsAssociationRequired
        ? "保存先未選択"
        : cmsCompactSaveLabel[effectiveCmsSaveState];
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

  if (cmsSessionState.kind === "unavailable" && cmsSessionState.error.status === 401) {
    return (
      <div className="studio-shell">
        <CmsLogin busy={loginBusy} error={loginError} onSubmit={login} />
      </div>
    );
  }

  return (
    <div className="studio-shell">
      {studioView === "editor" && !versionHistoryOpen && !cmsConflictResolverOpen ? (
        <div className="studio-editor-toolbar" aria-label="記事編集の操作" role="group">
          <a
            className="dads-button studio-library-shortcut"
            data-size="md"
            data-type="outline"
            href={studioViewHref("articles")}
            onClick={(event) => {
              event.preventDefault();
              showArticleLibrary();
            }}
          >
            記事一覧
          </a>
          <p
            aria-label={cmsEditorStatusDetails}
            aria-live="polite"
            className={`studio-editor-toolbar__status is-${cmsEditorVisualState}`}
            title={cmsEditorStatusDetails}
          >
            {cmsEditorStatus}
          </p>
          <div className="studio-editor-toolbar__secondary-actions">
            {!editorLocked ? <>
            <button
              aria-controls="studio-asset-tray"
              aria-expanded={assetTrayOpen}
              className="dads-button studio-assets-shortcut"
              data-size="md"
              data-type="outline"
              onClick={() => {
                setSettingsOpen(false);
                setPreviewFullscreen(false);
                setAssetTrayOpen((current) => !current);
              }}
              ref={assetTrigger}
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
                setAssetTrayOpen(false);
                setSettingsMode("metadata");
                setSettingsOpen((current) => settingsMode === "metadata" ? !current : true);
              }}
              type="button"
            >
              記事情報
              {validationVisible && settingsErrorCount > 0 ? ` (${settingsErrorCount})` : ""}
            </button>
            {cmsArticle ? <button
              aria-controls="cms-version-history"
              aria-expanded={versionHistoryOpen}
              className="dads-button studio-history-shortcut"
              data-size="md"
              data-type="outline"
              onClick={() => void openVersionHistory()}
              ref={versionHistoryTrigger}
              type="button"
            >
              履歴
            </button> : null}
            </> : null}
            {cmsWorkflowShortcut === "review" ? <button
              aria-controls="studio-article-settings"
              aria-expanded={settingsOpen && settingsMode === "review"}
              className="dads-button studio-review-shortcut"
              data-size="md"
              data-type="outline"
              onClick={() => {
                setPreviewFullscreen(false);
                setAssetTrayOpen(false);
                setSettingsMode("review");
                setSettingsOpen((current) => settingsMode === "review" ? !current : true);
              }}
              type="button"
            >
              レビュー
            </button> : cmsArticle ? <button
              aria-controls="studio-article-settings"
              aria-expanded={settingsOpen && settingsMode === "publish"}
              className="dads-button studio-publish-shortcut"
              data-size="md"
              data-type="solid-fill"
              onClick={() => {
                setPreviewFullscreen(false);
                setAssetTrayOpen(false);
                setSettingsMode("publish");
                setSettingsOpen((current) => settingsMode === "publish" ? !current : true);
              }}
              type="button"
            >
              公開
            </button> : null}
            {cmsArticle && cmsSession?.capabilities.canEdit ? <button
              aria-controls="studio-article-settings"
              aria-expanded={settingsOpen && settingsMode === "series"}
              className="dads-button studio-series-shortcut"
              data-size="md"
              data-type="outline"
              onClick={() => {
                setPreviewFullscreen(false);
                setAssetTrayOpen(false);
                setSettingsMode("series");
                setSettingsOpen((current) => settingsMode === "series" ? !current : true);
              }}
              type="button"
            >
              シリーズ
            </button> : null}
          </div>
          {!editorLocked ? <button
            className="dads-button studio-save-shortcut"
            data-size="md"
            data-type="solid-fill"
            disabled={cmsSaveDisabled}
            onClick={() => void saveCmsDraft()}
            type="button"
          >
            {cmsSaveButtonLabel}
          </button> : null}
        </div>
      ) : null}

      {studioView === "editor" && cmsConflict && !cmsConflictResolverOpen && !versionHistoryOpen ? (
        <section aria-labelledby="studio-conflict-notice-heading" className="studio-conflict-notice" role="alert">
          <div>
            <p className="studio-conflict-notice__eyebrow">入力内容は保護されています</p>
            <h2 id="studio-conflict-notice-heading">CMSに新しい変更があります</h2>
            <p>CMS最新版を確認し、自動で重ねられない箇所だけ保存を止めています。編集を続けることはできます。</p>
          </div>
          <div className="studio-conflict-notice__actions">
            <button
              className="dads-button"
              data-size="md"
              data-type="solid-fill"
              onClick={() => setCmsConflictResolverOpen(true)}
              type="button"
            >
              重なった変更を確認
            </button>
            <button className="dads-button" data-size="md" data-type="outline" onClick={downloadRecoveryCopy} type="button">
              Markdownを書き出す <Icon name="download" />
            </button>
          </div>
        </section>
      ) : null}

      {studioView !== "editor" ? (
        <nav aria-label="Studioの主要機能" className="studio-primary-nav">
          <strong>Noema Studio</strong>
          <div>
            <a aria-current={studioView === "articles" ? "page" : undefined} href={studioViewHref("articles")} onClick={(event) => { event.preventDefault(); showArticleLibrary(); }}>記事</a>
            <a aria-current={studioView === "assets" ? "page" : undefined} href={studioViewHref("assets")} onClick={(event) => { event.preventDefault(); showAssetLibrary(); }}>画像</a>
            {cmsSession?.capabilities.canManageMembers ? (
              <a aria-current={studioView === "team" ? "page" : undefined} href={studioViewHref("team")} onClick={(event) => { event.preventDefault(); showTeamSettings(); }}>チーム</a>
            ) : null}
          </div>
        </nav>
      ) : null}

      {operationMessage ? (
        <StudioNotification message={operationMessage} onDismiss={() => setOperationMessage(null)} />
      ) : null}

      {cmsSession ? (
        <CmsPasswordLoginMigration
          busy={passwordMigrationBusy}
          error={passwordMigrationError}
          onSubmit={configurePasswordLogin}
          session={cmsSession}
        />
      ) : null}

      {studioView === "articles" ? (
        <CmsArticleLibrary
          articles={cmsArticles}
          busy={cmsOperationBusy || cmsSaveState === "saving"}
          canCreate={Boolean(cmsSession?.capabilities.canEdit) && !editorLocked}
          canOpenArticles={Boolean(
            cmsSession?.capabilities.canEdit || cmsSession?.capabilities.canApprove
          )}
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
          series={cmsSeries}
          workingArticleActionLabel={cmsRecoveryReference
            ? recoveryNeedsConflictCheck
              ? "最新版への反映を続ける"
              : "編集を再開"
            : "編集画面に戻る"}
          workingArticleStatus={cmsLibraryWorkingStatus}
        />
      ) : studioView === "assets" ? (
        <CmsAssetLibrary
          assets={cmsAssets}
          busy={assetOperationBusy}
          canEdit={Boolean(cmsSession?.capabilities.canEdit)}
          connection={cmsAssetConnection}
          onDelete={deleteAsset}
          onRetry={() => setCmsRefresh((current) => current + 1)}
          onUpdate={saveAsset}
          onUpload={uploadAssets}
        />
      ) : studioView === "team" ? (
        <CmsTeamSettings
          active={cmsMemberActive}
          busy={cmsMembersBusy}
          connection={cmsLibraryConnection}
          email={cmsMemberEmail}
          error={cmsMembersError}
          members={cmsMembers}
          onActiveChange={setCmsMemberActive}
          onEdit={(member) => {
            setCmsMemberEmail(member.email);
            setCmsMemberRole(member.role);
            setCmsMemberActive(member.active);
            window.requestAnimationFrame(() => document.getElementById("cms-member-email")?.focus());
          }}
          onEmailChange={setCmsMemberEmail}
          onRetry={() => setCmsRefresh((current) => current + 1)}
          onRoleChange={setCmsMemberRole}
          onSubmit={(event) => void saveCmsMember(event)}
          role={cmsMemberRole}
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
      {cmsConflict && cmsConflictResolverOpen && cmsArticle ? (
        <CmsConflictResolver
          busy={cmsOperationBusy}
          latestState={cmsConflictLatestState.kind === "ready"
            ? cmsConflictLatestState
            : cmsConflictLatestState.kind === "error"
              ? { kind: "error", message: cmsConflictLatestState.error.message }
              : { kind: "loading" }}
          localBody={body}
          localFrontmatter={frontmatter}
          localVisibility={cmsVisibility}
          onBack={() => setCmsConflictResolverOpen(false)}
          onDownload={downloadRecoveryCopy}
          onResolve={applyConflictResolution}
          onRetry={() => setCmsConflictRefresh((current) => current + 1)}
          onUseLatest={useLatestConflictArticle}
        />
      ) : null}
      {versionHistoryOpen && cmsArticle ? (
        <CmsVersionHistory
          article={cmsArticle}
          hasUnsavedChanges={cmsDirty || cmsAutosavePaused}
          onClose={closeVersionHistory}
          onRestore={restoreCmsVersion}
        />
      ) : null}
      <main
        className={`studio-workspace ${editorLocked ? "is-review-workspace" : ""}`}
        hidden={cmsConflictResolverOpen || versionHistoryOpen}
        style={{ "--studio-side-panel-width": `${sidePanelWidth}px` } as CSSProperties}
      >
        <h1 className="sr-only">Noema Studio 記事エディター</h1>
        {(settingsOpen || assetTrayOpen) && !editorLocked ? (
          <StudioPanelResizeHandle
            onResize={(width) => setSidePanelWidth(clampStudioPanelWidth(width, window.innerWidth))}
            width={sidePanelWidth}
          />
        ) : null}
        <aside
          aria-label="記事設定"
          className={`studio-settings is-${settingsMode}`}
          hidden={!settingsOpen}
          id="studio-article-settings"
        >
          <StudioSurfaceHeader
            description={settingsMode === "review"
              ? "送信内容を確認し、コメント・承認・差し戻しを行います。"
              : settingsMode === "publish"
                ? "承認済みの内容と公開範囲を確認して公開します。"
                : settingsMode === "series"
                  ? "記事本文や承認状態を変えずに、読む順序とシリーズ情報を管理します。"
                  : "本文から自動整理されます。必要な項目だけ確認・修正できます。"}
            onClose={editorLocked ? undefined : () => setSettingsOpen(false)}
            title={settingsMode === "review"
              ? "レビュー"
              : settingsMode === "publish"
                ? "公開"
                : settingsMode === "series"
                  ? "シリーズ"
                  : "記事情報"}
            titleId="studio-settings-heading"
          />

          {settingsMode === "series" && cmsArticle ? (
            <section className="studio-series-settings" aria-labelledby="studio-settings-heading">
              {cmsArticle.publicationStatus === "published" ? (
                <p className="studio-series-settings__live-note" role="note">
                  <strong>公開中の記事です。</strong>
                  シリーズを保存すると、読者向けのシリーズ導線へすぐ反映されます。記事本文と承認状態は変わりません。
                </p>
              ) : null}
              <CmsArticleSeriesEditor
                articleId={cmsArticle.id}
                articles={cmsArticles}
                busy={cmsSeriesBusy}
                canEdit={Boolean(cmsSession?.capabilities.canEdit)}
                error={cmsSeriesError}
                onLoadVersions={loadCmsSeriesHistory}
                onSave={saveCmsSeries}
                series={cmsSeries}
              />
            </section>
          ) : null}

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
              }}
              type="button"
            >
              もう一度自動整理
            </button>
          </section>

          <details className="studio-cms studio-cms-workflow" id="cms-workflow" open={settingsMode !== "metadata"}>
            <summary className="studio-cms-workflow__summary">
              <span>記事の進行状況</span>
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
            <div className="studio-cms__current-article">
              <span>編集中の記事</span>
              <strong>{frontmatter.title || "新しい記事"}</strong>
              <small>{cmsArticle ? `revision ${cmsArticle.revisionNumber}` : "最初の保存でCMSに登録されます"}</small>
            </div>
            <CmsPublicationJourney
              currentRevisionPublished={Boolean(
                cmsArticle?.publicationStatus === "published" &&
                cmsArticle.publishedRevisionNumber === cmsArticle.revisionNumber
              )}
              publicationStatus={cmsArticle?.publicationStatus ?? "unpublished"}
              reviewStatus={cmsArticle?.reviewStatus ?? null}
            />
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
            {settingsMode === "review" ? <section className="studio-workflow-stage" aria-labelledby="cms-review-stage-heading">
              <div className="studio-workflow-stage__heading">
                <span>レビュー工程</span>
                <h3 id="cms-review-stage-heading">内容を確認して判断する</h3>
                <p>ここでは記事本体を変更せず、コメント・承認・差し戻しだけを行います。</p>
              </div>
              {cmsArticle?.reviewNote ? (
                <p className="studio-cms__review-note"><strong>直近の判断:</strong> {cmsArticle.reviewNote}</p>
              ) : null}
              {cmsArticle && ["in_review", "changes_requested", "approved"].includes(cmsArticle.reviewStatus) ? (
                <section aria-labelledby="cms-review-comments-heading" className="studio-review-comments">
                  <div className="studio-review-comments__heading">
                    <h3 id="cms-review-comments-heading">レビューコメント</h3>
                    <span>{cmsReviewComments.length}件</span>
                  </div>
                  {cmsReviewCommentsBusy ? <p role="status">コメントを読み込んでいます…</p> : null}
                  {!cmsReviewCommentsBusy && cmsReviewComments.length === 0 ? <p className="studio-review-comments__empty">コメントはまだありません。</p> : null}
                  {cmsReviewComments.length > 0 ? (
                    <ol className="studio-review-comments__list">
                      {cmsReviewComments.map((comment) => (
                        <li key={comment.id}>
                          <p>{comment.body}</p>
                          <small>
                            {comment.target === "body" ? "本文" : comment.target === "metadata" ? "記事情報" : "記事全体"}
                            {` · revision ${comment.revisionNumber} · ${comment.authorEmail} · `}
                            <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ja-JP")}</time>
                          </small>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {cmsSession?.capabilities.canComment ? (
                    <form className="studio-review-comments__form" onSubmit={(event) => { event.preventDefault(); void addCmsReviewComment(); }}>
                      <label htmlFor="cms-review-comment-target">コメント対象</label>
                      <select id="cms-review-comment-target" onChange={(event) => setCmsReviewCommentTarget(event.target.value as CmsReviewCommentTarget)} value={cmsReviewCommentTarget}>
                        <option value="article">記事全体</option>
                        <option value="body">本文</option>
                        <option value="metadata">記事情報</option>
                      </select>
                      <label htmlFor="cms-review-comment">コメント</label>
                      <textarea id="cms-review-comment" maxLength={1_000} onChange={(event) => setCmsReviewCommentBody(event.target.value)} placeholder="確認した点や、修正してほしい内容を具体的に書きます。" ref={reviewCommentInput} rows={4} value={cmsReviewCommentBody} />
                      <div className="studio-review-comments__form-actions">
                        <button className="dads-button" data-size="md" data-type="outline" disabled={cmsOperationBusy || !cmsReviewCommentBody.trim()} type="submit">コメントを追加</button>
                      </div>
                    </form>
                  ) : null}
                </section>
              ) : null}
              <h3 className="studio-cms__next-action">レビューの操作</h3>
              <div className="studio-cms__actions">
                {cmsCanRequestReview ? <button className="dads-button" data-size="md" data-type="solid-fill" disabled={editorLocked || cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("request_review")} type="button">レビューを依頼</button> : null}
                {cmsCanReview ? <button className="dads-button" data-size="md" data-type="solid-fill" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("approve")} type="button">承認する</button> : null}
                {cmsCanRequestChanges ? <button className="dads-button" data-size="md" data-type="outline" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict || !cmsReviewCommentBody.trim()} onClick={() => void runCmsAction("request_changes")} type="button">コメントして修正を依頼</button> : null}
                {cmsCanWithdrawReview ? <button className="dads-button" data-size="md" data-type="outline" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("withdraw_review")} type="button">レビューを取り下げて編集へ戻す</button> : null}
                {cmsCanRevokeApproval ? <button className="dads-button studio-cms__revoke-approval" data-size="md" data-type="outline" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("revoke_approval")} type="button">承認を取り消す</button> : null}
                {cmsSession?.capabilities.canPublish && cmsArticle?.reviewStatus === "approved" ? <button className="dads-button" data-size="md" data-type="solid-fill" onClick={() => setSettingsMode("publish")} type="button">公開設定へ進む</button> : null}
              </div>
              {cmsAutosavePaused ? <p className="studio-cms__pending-message">復旧内容はまだCMSへ反映していません。内容を確認して「保存」を押すと、レビューを依頼できます。</p> : null}
              {cmsArticle?.reviewStatus === "in_review" && cmsSelfApprovalBlocked ? <p className="studio-cms__pending-message">自分が保存した最新版は承認できません。別のレビュー担当者または管理者に承認を依頼してください。</p> : null}
            </section> : null}

            {settingsMode === "publish" ? <section className="studio-workflow-stage studio-publish-stage" aria-labelledby="cms-publish-stage-heading">
              <div className="studio-workflow-stage__heading">
                <span>公開工程</span>
                <h3 id="cms-publish-stage-heading">公開内容と範囲を最終確認する</h3>
                <p>公開範囲は下書きの編集項目ではなく、この画面で公開する時にだけ設定します。</p>
              </div>
              <button className="dads-button studio-publish-stage__back" data-size="sm" data-type="outline" onClick={() => setSettingsMode("review")} type="button">レビューへ戻る</button>
              {cmsArticle?.reviewStatus !== "approved" ? (
                <div className="studio-publish-readiness" role="status">
                  <strong>公開前にレビュー承認が必要です</strong>
                  <p>レビューで内容を承認すると、このrevisionを公開できるようになります。</p>
                  <button className="dads-button" data-size="md" data-type="outline" onClick={() => setSettingsMode("review")} type="button">レビューを開く</button>
                </div>
              ) : (
                <p className="studio-publish-readiness is-ready"><strong>revision {cmsArticle.revisionNumber} は承認済みです。</strong> 公開範囲を選び、公開内容を確定してください。</p>
              )}
              <fieldset className="studio-cms__visibility" disabled={!cmsSession?.capabilities.canPublish || cmsOperationBusy}>
                <legend>公開範囲</legend>
                {(Object.keys(cmsVisibilityLabels) as CmsVisibility[]).map((visibility) => {
                  const unavailable = visibility === "restricted" || visibility === "internal";
                  return <label key={visibility} className={unavailable ? "is-pending" : ""}>
                    <input checked={cmsPublishVisibility === visibility} disabled={unavailable} name="cms-publish-visibility" onChange={() => setCmsPublishVisibility(visibility)} type="radio" value={visibility} />
                    <span><strong>{cmsVisibilityLabels[visibility]}</strong><small>{cmsVisibilityDescriptions[visibility]}{unavailable ? "（現在は選択できません）" : ""}</small></span>
                  </label>;
                })}
              </fieldset>
              <h3 className="studio-cms__next-action">公開の操作</h3>
              <div className="studio-cms__actions">
                {cmsCanPublish ? <button className="dads-button" data-size="md" data-type="solid-fill" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("publish")} type="button">revision {cmsArticle?.revisionNumber}を公開する</button> : null}
                {cmsSession?.capabilities.canPublish && cmsArticle?.publicationStatus === "published" ? <button className="dads-button" data-size="md" data-type="outline" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("archive")} type="button">公開を終了する</button> : null}
                {cmsSession?.capabilities.canPublish && cmsArticle?.publicationStatus === "archived" ? <button className="dads-button" data-size="md" data-type="outline" disabled={cmsOperationBusy || cmsSaveState === "saving" || cmsAutosavePaused || cmsConflict} onClick={() => void runCmsAction("restore")} type="button">未公開状態へ戻す</button> : null}
              </div>
              {cmsArticle?.reviewStatus === "approved" && !cmsCanPublish && cmsArticle.publicationStatus === "published" && cmsArticle.publishedRevisionNumber === cmsArticle.revisionNumber ? <p className="studio-cms__published-note">このrevisionはすでに公開中です。内容を変える場合は、承認を取り消してレビューからやり直してください。</p> : null}
            </section> : null}
            <p className="sr-only" aria-live="polite">{saveStatus}</p>
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
                レビュー依頼の内容を安全に確認するため固定しています。本文はプレビューで確認し、修正が必要な箇所はコメントしてください。
              </p>
              <dl>
                <div><dt>タイトル</dt><dd>{frontmatter.title}</dd></div>
                <div><dt>スラッグ</dt><dd><code>{frontmatter.slug}</code></dd></div>
                <div><dt>概要</dt><dd>{frontmatter.description}</dd></div>
                <div><dt>読後の到達点</dt><dd>{frontmatter.outcome}</dd></div>
                <div><dt>執筆者</dt><dd>{frontmatter.authors.join("、")}</dd></div>
                <div><dt>テーマ</dt><dd>{frontmatter.topics.map((topic) => topicLabels[topic]).join("、")}</dd></div>
                <div><dt>記事タイプ</dt><dd>{approachLabels[frontmatter.approach]}</dd></div>
                <div><dt>読了時間</dt><dd>{frontmatter.estimatedMinutes}分</dd></div>
                <div><dt>タグ</dt><dd>{frontmatter.tags.length > 0 ? frontmatter.tags.join("、") : "なし"}</dd></div>
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
              <summary>基本情報 — {frontmatter.title || "自動整理待ち"}</summary>
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
                  <p className="studio-field__support" id="article-topic-support">1〜{MAX_ARTICLE_TOPICS}つ選びます。最初に選んだテーマが主テーマです。</p>
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
                  <p aria-live="polite" className="studio-field__counter" id="article-topic-count">選択中 {frontmatter.topics.length} / {MAX_ARTICLE_TOPICS}</p>
                  {error ? <p className="studio-field__error" id="article-topic-error">エラー — {error}</p> : null}
                </fieldset>
              );
            })()}
              </div>
            </details>

            <details className="studio-disclosure" open={metadataOpen} onToggle={(event) => setMetadataOpen(event.currentTarget.open)}>
              <summary>詳細設定 — URL・執筆者・分類</summary>
              <div className="studio-disclosure__content">
                {(() => {
                  const error = fieldError(visibleReviewIssues, "slug", validationVisible);
                  return <Field id="article-slug" label="URLスラッグ" support="公開URLに使う半角英数字とハイフンです。通常は変更不要です。" error={error}>
                    <input id="article-slug" className="dads-input-text__input" required {...inputA11y("article-slug", false, error)} value={frontmatter.slug} onChange={(event) => update("slug", event.target.value)} />
                  </Field>;
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "authors", validationVisible);
                  return <Field id="article-authors" label="執筆者" support="複数の場合はカンマで区切ります。" error={error}>
                    <input id="article-authors" className="dads-input-text__input" required {...inputA11y("article-authors", true, error)} value={frontmatter.authors.join(", ")} onChange={(event) => update("authors", event.target.value.split(",").map((author) => author.trim()))} onBlur={() => update("authors", frontmatter.authors.filter(Boolean))} />
                  </Field>;
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "approach", validationVisible);
                  return <Field id="article-approach" label="記事タイプ" error={error}>
                    <select id="article-approach" required {...inputA11y("article-approach", false, error)} value={frontmatter.approach} onChange={(event) => update("approach", event.target.value as ArticleFrontmatter["approach"])}>
                      {Object.entries(approachLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>;
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
                <div className="studio-managed-metadata" role="note">
                  <strong>CMSが自動で管理</strong>
                  <span>公開日時は公開操作時、更新日は保存時に記録します。読了時間は本文から算出します（現在約{frontmatter.estimatedMinutes}分）。</span>
                </div>
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
          <h2 className="sr-only" id="editor-heading">{previewFullscreen ? "記事プレビュー" : "Markdown本文"}</h2>
          {editorLocked ? (
            <p className="studio-editor__lock" role="status">
              {contentReviewLocked
                ? "レビュー対象の本文を固定しています。内容を確認し、必要な点はレビューコメントへ残してください。"
                : "この役割では記事本体を編集できません。レビューコメントとワークフロー操作を利用できます。"}
            </p>
          ) : null}
          <div className={`studio-writing-layout has-preview ${previewFullscreen || editorLocked ? "is-preview-only" : ""}`}>
            <div className="studio-writing-controls">
              {validationVisible && blockingErrorCount > 0 ? <button type="button" onClick={focusValidation} aria-controls="article-validation">入力エラー {blockingErrorCount}</button> : null}
              {!editorLocked ? <button
                aria-pressed={previewFullscreen}
                className="studio-preview-toggle"
                onClick={() => {
                  setSettingsOpen(false);
                  setAssetTrayOpen(false);
                  setPreviewFullscreen((current) => !current);
                }}
                type="button"
              >
                {previewFullscreen ? "編集に戻る" : "プレビューのみ"}
              </button> : null}
            </div>
            <div className={`studio-writing-canvas ${assetDropActive ? "is-asset-drop" : ""}`} hidden={previewFullscreen || editorLocked}>
              <label className="sr-only" htmlFor="article-body">Markdown本文</label>
              <textarea
                aria-describedby="article-body-help"
                aria-errormessage={bodyInvalid ? "article-body-error" : undefined}
                aria-invalid={bodyInvalid || undefined}
                aria-required="true"
                aria-readonly={editorLocked}
                id="article-body"
                onDragEnter={(event) => {
                  if (event.dataTransfer.types.includes(noemaAssetDragType)) setAssetDropActive(true);
                }}
                onDragLeave={() => setAssetDropActive(false)}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(noemaAssetDragType)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  setAssetDropActive(false);
                  const assetId = event.dataTransfer.getData(noemaAssetDragType);
                  if (!assetId) return;
                  event.preventDefault();
                  const asset = cmsAssets.find((item) => item.id === assetId);
                  if (asset) insertBodyAsset(asset);
                }}
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
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </div>
          <p className="sr-only" id="article-body-help">Markdown形式で本文を入力します。H1見出しとraw HTMLは使用できません。</p>
          <p className="sr-only" id="article-body-error">{bodyErrorMessage ? `エラー — ${bodyErrorMessage}` : ""}</p>
        </section>

        {assetTrayOpen ? (
          <CmsAssetTray
            assets={cmsAssets}
            busy={assetOperationBusy}
            canEdit={Boolean(cmsSession?.capabilities.canEdit) && !editorLocked}
            onClose={closeAssetTray}
            onInsert={insertBodyAsset}
            onManage={showAssetLibrary}
            onUpload={uploadAssets}
          />
        ) : null}

      </main>
        </>
      )}

      {assetPickerTarget ? (
        <CmsAssetPicker
          assets={cmsAssets}
          busy={assetOperationBusy}
          mode="hero"
          onClose={closeAssetPicker}
          onInsert={insertAsset}
          onUpload={uploadAssets}
        />
      ) : null}

    </div>
  );
}
