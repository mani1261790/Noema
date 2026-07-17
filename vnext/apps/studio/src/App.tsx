import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
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
  articleSubmissionRequestSchema,
  type ArticleSubmissionValidationIssue
} from "@noema/studio-publication";
import {
  clearDraft,
  createBlankArticle,
  loadDraft,
  resolveBrowserStorage,
  saveDraft,
  type DraftStorage
} from "./draft-storage";
import {
  PUBLICATION_ATTEMPT_STORAGE_KEY,
  cancelArticleSubmission,
  clearInvalidPublicationAttemptSafely,
  clearPublicationAttemptSafely,
  createArticleSubmission,
  fetchPublicationCapabilities,
  loadPublicationAttempt,
  resumeArticleSubmission,
  retryPublicationAttempt,
  type PublicationActionResult,
  type PublicationAttempt,
  type PublicationCapabilities,
  type PublicationClientError,
  type PublicationSuccess
} from "./publication-client";
import { createPreviewMarkdown, resolvePublicSiteReference } from "./preview-markdown";

type Pane = "settings" | "write" | "preview";
type OperationMessage = { text: string; tone: "error" | "info" | "success" };
type CapabilityState =
  | { kind: "checking" }
  | { capabilities: PublicationCapabilities; kind: "ready" }
  | { error: PublicationClientError; kind: "unavailable" };

const publicSiteUrl = import.meta.env.VITE_PUBLIC_SITE_URL || "http://localhost:4321";
const markdown = createPreviewMarkdown(publicSiteUrl);
const reviewValidationSubmissionId = "00000000-0000-4000-8000-000000000000";
const paneOrder: Pane[] = ["settings", "write", "preview"];
const paneLabels: Record<Pane, string> = {
  settings: "設定",
  write: "本文",
  preview: "プレビュー"
};

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

function issueControlId(issue: ArticleSubmissionValidationIssue): string | null {
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
  attempt: PublicationAttempt | null;
  body: string;
  frontmatter: ArticleFrontmatter;
  invalidAttemptStorage: boolean;
  message: OperationMessage | null;
  saveStatus: string;
  storage: DraftStorage;
}

function getInitialState(): InitialState {
  const { available: storageAvailable, storage } = resolveBrowserStorage(window);
  const attempt = loadPublicationAttempt(storage);
  if (attempt) {
    const cancelled = attempt.status.kind === "succeeded" && attempt.status.result.outcome === "cancelled";
    return {
      attempt,
      body: attempt.request.markdown,
      frontmatter: attempt.request.frontmatter,
      invalidAttemptStorage: false,
      message: {
        text: cancelled
          ? "取り消したレビュー依頼の内容を復元しています。"
          : "前回のレビュー依頼を復元しました。状態を確認するまで内容は固定されます。",
        tone: cancelled ? "success" : "info"
      },
      saveStatus: cancelled ? "取り消した内容を復元中" : "送信内容を復元しました",
      storage
    };
  }

  let invalidAttemptStorage = false;
  try {
    invalidAttemptStorage = storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY) !== null;
  } catch {
    // The publication client will report storage unavailability if the user submits.
  }

  const loadedDraft = loadDraft(storage);
  if (loadedDraft.status === "restored") {
    return {
      attempt: null,
      body: loadedDraft.draft.body,
      frontmatter: loadedDraft.draft.frontmatter,
      invalidAttemptStorage,
      message: invalidAttemptStorage
        ? {
            text: "以前の送信記録を安全に読み込めません。下書きは復元できています。",
            tone: "error"
          }
        : {
            text: "このブラウザに保存した下書きを復元しました。",
            tone: "success"
      },
      saveStatus: "保存した下書きを復元しました",
      storage
    };
  }

  return {
    attempt: null,
    body: "",
    frontmatter: createBlankArticle(),
    invalidAttemptStorage,
    message: !storageAvailable
      ? {
          text: "このブラウザでは自動保存を利用できません。入力後はMarkdownを書き出して保管してください。",
          tone: "error"
        }
      : invalidAttemptStorage
      ? {
          text: "以前の送信記録を安全に読み込めません。修復してからレビューを依頼してください。",
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

function normalizedIssuePath(issue: ArticleSubmissionValidationIssue): Array<string | number> {
  return issue.path[0] === "frontmatter" ? issue.path.slice(1) : issue.path;
}

function normalizedIssueField(issue: ArticleSubmissionValidationIssue): string | null {
  const path = normalizedIssuePath(issue);
  return typeof path[0] === "string" ? path[0] : null;
}

function japaneseIssueMessage(issue: ArticleSubmissionValidationIssue): string {
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
  issues: ArticleSubmissionValidationIssue[]
): ArticleSubmissionValidationIssue[] {
  const unique = new Map<string, ArticleSubmissionValidationIssue>();
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
  issues: ArticleSubmissionValidationIssue[],
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
  issues: ArticleSubmissionValidationIssue[],
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

function publicationOutcomeLabel(result: PublicationSuccess): string {
  switch (result.outcome) {
    case "open":
      return "Draft PRを準備しました";
    case "merged":
      return "レビュー済みの記事がdevelopへ反映されました";
    case "closed":
      return "Draft PRはマージされずに閉じられました";
    case "cancelled":
      return "レビュー依頼を取り消しました";
  }
}

export function App() {
  const [initialState] = useState(getInitialState);
  const storage = initialState.storage;
  const [frontmatter, setFrontmatter] = useState(initialState.frontmatter);
  const [body, setBody] = useState(initialState.body);
  const [attempt, setAttempt] = useState<PublicationAttempt | null>(initialState.attempt);
  const [invalidAttemptStorage, setInvalidAttemptStorage] = useState(initialState.invalidAttemptStorage);
  const [activePane, setActivePane] = useState<Pane>("write");
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 1199px)").matches);
  const [saveStatus, setSaveStatus] = useState(initialState.saveStatus);
  const [operationMessage, setOperationMessage] = useState<OperationMessage | null>(initialState.message);
  const [capabilityState, setCapabilityState] = useState<CapabilityState>({ kind: "checking" });
  const [capabilityRefresh, setCapabilityRefresh] = useState(0);
  const [validationRequested, setValidationRequested] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationIssues, setPublicationIssues] = useState<ArticleSubmissionValidationIssue[]>([]);
  const [metadataOpen, setMetadataOpen] = useState(true);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const validationSection = useRef<HTMLElement>(null);
  const reviewSection = useRef<HTMLElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const cancelledRecoveryInFlight = useRef<string | null>(null);
  const tabRefs = useRef<Record<Pane, HTMLButtonElement | null>>({ settings: null, write: null, preview: null });
  const deferredBody = useDeferredValue(body);

  const previewHtml = useMemo(
    () => DOMPurify.sanitize(markdown.render(deferredBody), { ADD_ATTR: ["target"] }),
    [deferredBody]
  );
  const bodyIssues = useMemo(() => validateArticleMarkdown(deferredBody), [deferredBody]);
  const bodyErrors = bodyIssues.filter((issue) => issue.severity === "error");
  const reviewValidation = useMemo(
    () => articleSubmissionRequestSchema.safeParse({
      version: 1,
      operation: "create_article",
      submissionId: reviewValidationSubmissionId,
      frontmatter,
      markdown: deferredBody
    }),
    [deferredBody, frontmatter]
  );
  const localReviewIssues = useMemo<ArticleSubmissionValidationIssue[]>(
    () => reviewValidation.success
      ? []
      : normalizeReviewIssues(reviewValidation.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.map((segment) => typeof segment === "number" ? segment : String(segment))
        }))),
    [reviewValidation]
  );
  const visibleReviewIssues = publicationIssues.length > 0 ? publicationIssues : localReviewIssues;
  const blockingErrorCount = visibleReviewIssues.length;
  const settingsErrorCount = visibleReviewIssues.filter((issue) => normalizedIssueField(issue) !== "markdown").length;
  const visibleBodyErrorCount = visibleReviewIssues.filter((issue) => normalizedIssueField(issue) === "markdown").length;
  const bodyTabErrorCount = Math.max(bodyErrors.length, visibleBodyErrorCount);
  const visibleSettingsIssues = visibleReviewIssues.filter((issue) => normalizedIssueField(issue) !== "markdown");
  const bodyReviewIssue = visibleReviewIssues.find((issue) => normalizedIssueField(issue) === "markdown");
  const bodyErrorMessage = bodyReviewIssue?.message ?? bodyErrors[0]?.message;
  const bodyInvalid = (validationRequested || publicationIssues.length > 0) && Boolean(bodyErrorMessage);
  const editorialWarnings = [
    ...(frontmatter.sources.length === 0 ? ["出典がまだ登録されていません。"] : [])
  ];
  const baseValidation = articleFrontmatterSchema.safeParse(frontmatter);
  const canExport = baseValidation.success && bodyErrors.length === 0;
  const attemptResult = attempt?.status.kind === "succeeded" ? attempt.status.result : null;
  const attemptCancelled = attemptResult?.outcome === "cancelled";
  const editorLocked = publicationBusy || Boolean(attempt);
  const canAbandonAttempt = attempt?.status.kind === "failed" &&
    attempt.status.operation === "create" &&
    ["article_already_exists", "open_submission_exists"].includes(attempt.status.error.code);
  const canStartNewArticle = !invalidAttemptStorage && (!attempt || Boolean(attemptResult) || canAbandonAttempt);
  const capabilityEnabled = capabilityState.kind === "ready" && capabilityState.capabilities.publication.enabled;

  const resumeEditingAfterCancellation = useCallback(async () => {
    if (!attempt || attempt.status.kind !== "succeeded" || attempt.status.result.outcome !== "cancelled") return;
    const submissionId = attempt.request.submissionId;
    if (cancelledRecoveryInFlight.current === submissionId) return;
    cancelledRecoveryInFlight.current = submissionId;
    setPublicationBusy(true);

    const savedDraft = saveDraft(storage, {
      frontmatter: attempt.request.frontmatter,
      body: attempt.request.markdown
    });
    if (!savedDraft.ok) {
      setOperationMessage({
        text: "取り消した内容を下書きへ保存できませんでした。送信記録を残しているため、もう一度試せます。",
        tone: "error"
      });
      cancelledRecoveryInFlight.current = null;
      setPublicationBusy(false);
      return;
    }

    const clearedAttempt = await clearPublicationAttemptSafely(attempt, { storage });
    if (clearedAttempt.ok) {
      setAttempt(null);
      setSaveStatus("このブラウザに保存済み");
      setOperationMessage({ text: "取り消した内容を下書きとして復元しました。編集を再開できます。", tone: "success" });
    } else {
      if (clearedAttempt.attempt) {
        setAttempt(clearedAttempt.attempt);
        setFrontmatter(clearedAttempt.attempt.request.frontmatter);
        setBody(clearedAttempt.attempt.request.markdown);
      }
      setOperationMessage({
        text: clearedAttempt.error.code === "publication_attempt_changed"
          ? "別のタブで送信状態が更新されました。最新の状態を表示しています。"
          : "送信記録を安全に解除できませんでした。内容は保持されています。",
        tone: "error"
      });
    }
    cancelledRecoveryInFlight.current = null;
    setPublicationBusy(false);
  }, [attempt]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1199px)");
    const updateLayout = (event: MediaQueryListEvent) => setCompactLayout(event.matches);
    setCompactLayout(query.matches);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setCapabilityState({ kind: "checking" });
    void fetchPublicationCapabilities({ signal: controller.signal }).then((result) => {
      if (!current || controller.signal.aborted) return;
      setCapabilityState(result.ok
        ? { capabilities: result.capabilities, kind: "ready" }
        : { error: result.error, kind: "unavailable" });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [capabilityRefresh]);

  useEffect(() => {
    if (attemptCancelled) void resumeEditingAfterCancellation();
  }, [attemptCancelled, resumeEditingAfterCancellation]);

  useEffect(() => {
    if (editorLocked) return;
    setSaveStatus("保存中…");
    const timer = window.setTimeout(() => {
      const result = saveDraft(storage, { frontmatter, body });
      setSaveStatus(result.ok ? "このブラウザに保存済み" : "下書きを保存できません");
      if (!result.ok) {
        setOperationMessage({
          text: "ブラウザに下書きを保存できませんでした。Markdownを書き出して内容を保管してください。",
          tone: "error"
        });
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [body, editorLocked, frontmatter]);

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
    setFrontmatter((current) => ({ ...current, [key]: value }));
    setPublicationIssues([]);
  };

  const focusValidation = () => {
    setValidationRequested(true);
    setActivePane("settings");
    window.requestAnimationFrame(() => {
      validationSection.current?.focus({ preventScroll: true });
      validationSection.current?.scrollIntoView({ block: "center" });
    });
  };

  const focusBodyIssue = (issue?: ArticleMarkdownIssue) => {
    setActivePane("write");
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

  const focusReviewIssue = (issue: ArticleSubmissionValidationIssue) => {
    const field = normalizedIssueField(issue);
    if (field === "markdown") {
      focusBodyIssue(bodyIssues.find((bodyIssue) => bodyIssue.message === issue.message));
      return;
    }
    if (field === "heroImage") setMediaOpen(true);
    if (field === "sources") setSourcesOpen(true);
    setActivePane("settings");
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

  const importMarkdown = async (file?: File) => {
    if (!file || editorLocked) return;
    try {
      const parsed = await parseArticle(await file.text());
      const hasCurrentInput = body.length > 0 || JSON.stringify(frontmatter) !== JSON.stringify(createBlankArticle());
      if (hasCurrentInput && !window.confirm("現在の入力内容を、読み込んだMarkdownで置き換えますか？")) return;
      setFrontmatter(parsed.frontmatter);
      setBody(parsed.markdown);
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

  const resetDraft = async () => {
    if (!canStartNewArticle || publicationBusy) return;
    const warning = canAbandonAttempt
      ? "この送信は記事やPRを作成する前に停止しています。送信記録と現在の下書きを破棄して、新しい記事を作成しますか？"
      : attemptResult?.outcome === "open"
        ? "開いているDraft PRは残ります。新しい記事の入力を始めますか？"
        : "現在の入力内容と、このブラウザに保存した下書きを破棄して、新しい記事を作成しますか？";
    if (!window.confirm(warning)) return;
    setPublicationBusy(true);
    const clearedAttempt = await clearPublicationAttemptSafely(attempt, { storage });
    if (!clearedAttempt.ok) {
      if (clearedAttempt.attempt) {
        setAttempt(clearedAttempt.attempt);
        setFrontmatter(clearedAttempt.attempt.request.frontmatter);
        setBody(clearedAttempt.attempt.request.markdown);
      }
      setOperationMessage({
        text: clearedAttempt.error.code === "publication_attempt_changed"
          ? "別のタブで送信状態が更新されました。最新の状態を表示したため、内容を確認してください。"
          : "ブラウザのレビュー依頼記録を安全に消去できないため、新しい記事を開始できません。",
        tone: "error"
      });
      setPublicationBusy(false);
      return;
    }
    const draftCleared = clearDraft(storage);
    setAttempt(null);
    setFrontmatter(createBlankArticle());
    setBody("");
    setValidationRequested(false);
    setPublicationIssues([]);
    setActivePane("settings");
    setOperationMessage(draftCleared.ok
      ? { text: "新しい記事を作成します。", tone: "info" }
      : {
          text: "新しい記事を開きましたが、以前の下書きをブラウザから消去できませんでした。",
          tone: "error"
        });
    setPublicationBusy(false);
  };

  const updateSource = (index: number, key: "checkedAt" | "title" | "url", value: string) => {
    update("sources", frontmatter.sources.map((source, sourceIndex) =>
      sourceIndex === index ? { ...source, [key]: value } : source
    ));
  };

  const openReview = () => {
    setActivePane("settings");
    window.requestAnimationFrame(() => {
      reviewSection.current?.scrollIntoView({ block: "center" });
      const button = reviewButton.current;
      if (button && !button.disabled) button.focus({ preventScroll: true });
      else reviewSection.current?.focus({ preventScroll: true });
    });
  };

  const requestReview = () => {
    setValidationRequested(true);
    const currentValidation = articleSubmissionRequestSchema.safeParse({
      version: 1,
      operation: "create_article",
      submissionId: reviewValidationSubmissionId,
      frontmatter,
      markdown: body
    });
    if (!currentValidation.success) {
      setPublicationIssues(normalizeReviewIssues(currentValidation.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map((segment) => typeof segment === "number" ? segment : String(segment))
      }))));
      setOperationMessage({ text: "レビューへ送る前に入力エラーを確認してください。", tone: "error" });
      focusValidation();
      return;
    }
    setPublicationIssues([]);
    if (!capabilityEnabled || editorLocked) return;
    confirmDialog.current?.showModal();
  };

  const applyPublicationResult = (result: PublicationActionResult) => {
    if (result.attempt) {
      setInvalidAttemptStorage(false);
      setAttempt(result.attempt);
      setFrontmatter(result.attempt.request.frontmatter);
      setBody(result.attempt.request.markdown);
    }
    if (result.ok) {
      setInvalidAttemptStorage(false);
      setPublicationIssues([]);
      setOperationMessage({ text: publicationOutcomeLabel(result.result), tone: "success" });
      return;
    }
    if (!result.attempt && result.error.code === "invalid_stored_attempt") {
      setInvalidAttemptStorage(true);
    }
    setPublicationIssues(normalizeReviewIssues(result.error.issues ?? []));
    if (result.error.issues?.length) setValidationRequested(true);
    setOperationMessage({
      text: result.outcomeUnknown
        ? "送信結果を確認できませんでした。内容を変更せず、もう一度確認してください。"
        : result.error.message,
      tone: "error"
    });
  };

  const submitReview = async () => {
    confirmDialog.current?.close();
    setPublicationBusy(true);
    setOperationMessage({ text: "Draft PRを準備しています…", tone: "info" });
    const result = await createArticleSubmission(
      { frontmatter, markdown: body },
      { storage }
    );
    applyPublicationResult(result);
    setPublicationBusy(false);
  };

  const retryAttempt = async () => {
    if (!attempt || publicationBusy) return;
    setPublicationBusy(true);
    setOperationMessage({ text: "同じ送信内容で状態を確認しています…", tone: "info" });
    const result = await retryPublicationAttempt(attempt, { storage });
    applyPublicationResult(result);
    setPublicationBusy(false);
  };

  const resumeAttempt = async () => {
    if (!attempt || publicationBusy) return;
    if (!window.confirm("取り消しをやめて、元の内容でDraft PRの作成・状態確認を続けますか？")) return;
    setPublicationBusy(true);
    setOperationMessage({ text: "元の送信内容で状態を再確認しています…", tone: "info" });
    const result = await resumeArticleSubmission(attempt, { storage });
    applyPublicationResult(result);
    setPublicationBusy(false);
  };

  const repairInvalidAttemptStorage = async () => {
    if (!invalidAttemptStorage || publicationBusy) return;
    if (!window.confirm("安全に読み込めない送信記録だけを削除しますか？ 現在の下書き内容は残ります。")) return;
    setPublicationBusy(true);
    const result = await clearInvalidPublicationAttemptSafely({ storage });
    if (result.ok) {
      setInvalidAttemptStorage(false);
      setOperationMessage({ text: "以前の送信記録を修復しました。下書き内容はそのままです。", tone: "success" });
    } else if (result.attempt) {
      setInvalidAttemptStorage(false);
      setAttempt(result.attempt);
      setFrontmatter(result.attempt.request.frontmatter);
      setBody(result.attempt.request.markdown);
      setOperationMessage({
        text: "別のタブで有効な送信状態へ更新されました。最新の内容を表示しています。",
        tone: "info"
      });
    } else {
      setOperationMessage({ text: "送信記録を安全に修復できませんでした。ブラウザの保存設定を確認してください。", tone: "error" });
    }
    setPublicationBusy(false);
  };

  const cancelAttempt = async () => {
    if (!attempt || publicationBusy) return;
    if (!window.confirm("このレビュー依頼を取り消しますか？ GitHub側の作成が始まっている場合は取り消せません。")) return;
    setPublicationBusy(true);
    setOperationMessage({ text: "レビュー依頼を取り消しています…", tone: "info" });
    const result = await cancelArticleSubmission(attempt, { storage });
    if (result.ok && result.result.outcome === "cancelled") {
      cancelledRecoveryInFlight.current = result.attempt.request.submissionId;
    }
    applyPublicationResult(result);
    if (result.ok && result.result.outcome === "cancelled") {
      const savedDraft = saveDraft(storage, {
        frontmatter: result.attempt.request.frontmatter,
        body: result.attempt.request.markdown
      });
      if (!savedDraft.ok) {
        setOperationMessage({
          text: "取り消しは完了しましたが、内容を下書きへ保存できませんでした。送信記録は安全のため残しています。",
          tone: "error"
        });
        cancelledRecoveryInFlight.current = null;
        setPublicationBusy(false);
        return;
      }
      const clearedAttempt = await clearPublicationAttemptSafely(result.attempt, { storage });
      if (clearedAttempt.ok) {
        setAttempt(null);
        setSaveStatus("このブラウザに保存済み");
        setOperationMessage({ text: "レビュー依頼を取り消しました。編集を再開できます。", tone: "success" });
      } else {
        if (clearedAttempt.attempt) {
          setAttempt(clearedAttempt.attempt);
          setFrontmatter(clearedAttempt.attempt.request.frontmatter);
          setBody(clearedAttempt.attempt.request.markdown);
        }
        setOperationMessage({
          text: clearedAttempt.error.code === "publication_attempt_changed"
            ? "取り消し後に別のタブで送信状態が更新されました。最新の状態を確認してください。"
            : "取り消しは完了しましたが、ブラウザの送信記録を安全に消去できませんでした。",
          tone: "error"
        });
      }
      cancelledRecoveryInFlight.current = null;
    }
    setPublicationBusy(false);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, pane: Pane) => {
    if (!compactLayout || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = paneOrder.indexOf(pane);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? paneOrder.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + paneOrder.length) % paneOrder.length;
    const nextPane = paneOrder[nextIndex];
    setActivePane(nextPane);
    tabRefs.current[nextPane]?.focus();
  };

  const validationVisible = validationRequested || publicationIssues.length > 0;
  const publicationStatus = attempt?.status;
  const failedAttemptNeedsReload = publicationStatus?.kind === "failed" &&
    ["invalid_stored_attempt", "publication_attempt_changed"].includes(publicationStatus.error.code);
  const failedCancellation = publicationStatus?.kind === "failed" && publicationStatus.operation === "cancel";
  const pullRequest = publicationStatus?.kind === "succeeded" && publicationStatus.result.outcome !== "cancelled"
    ? publicationStatus.result.pullRequest
    : null;

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand__mark" aria-hidden="true">N</span>
          <span className="studio-brand__text">Noema <strong>Studio</strong><small aria-live="polite">{saveStatus}</small></span>
        </div>
        <div className="studio-header__actions">
          <a className="dads-button studio-public-link" data-size="md" data-type="outline" href={publicSiteUrl} target="_blank" rel="noreferrer">
            公開サイト <Icon name="external" />
          </a>
          <button className="dads-button studio-review-shortcut" data-size="md" data-type="solid-fill" type="button" onClick={openReview}>
            <span className="studio-action-label--full">レビューを依頼</span><span className="studio-action-label--short">レビュー</span>
          </button>
        </div>
      </header>

      {operationMessage ? (
        <div className={`studio-notification is-${operationMessage.tone}`} role={operationMessage.tone === "error" ? "alert" : "status"}>
          <span>{operationMessage.text}</span>
          <button type="button" onClick={() => setOperationMessage(null)} aria-label="通知を閉じる">閉じる</button>
        </div>
      ) : null}

      {compactLayout ? (
        <div className="studio-tabs" role="tablist" aria-label="編集画面">
          {paneOrder.map((pane) => (
            <button
              aria-controls={`studio-pane-${pane}`}
              aria-selected={activePane === pane}
              id={`studio-tab-${pane}`}
              key={pane}
              onClick={() => setActivePane(pane)}
              onKeyDown={(event) => handleTabKeyDown(event, pane)}
              ref={(node) => { tabRefs.current[pane] = node; }}
              role="tab"
              tabIndex={activePane === pane ? 0 : -1}
              type="button"
            >
              {paneLabels[pane]}
              {pane === "settings" && settingsErrorCount > 0 ? ` (${settingsErrorCount})` : ""}
              {pane === "write" && bodyTabErrorCount > 0 ? ` (${bodyTabErrorCount})` : ""}
            </button>
          ))}
        </div>
      ) : null}

      <main className="studio-workspace">
        <h1 className="sr-only">Noema Studio 記事エディター</h1>
        <aside
          aria-label="記事設定"
          aria-labelledby={compactLayout ? "studio-tab-settings" : undefined}
          className="studio-settings"
          hidden={compactLayout && activePane !== "settings"}
          id="studio-pane-settings"
          role={compactLayout ? "tabpanel" : undefined}
          tabIndex={compactLayout ? 0 : undefined}
        >
          <div className="studio-pane-title">
            <p>ARTICLE SETTINGS</p>
            <h2>記事の設定</h2>
            <span>必須項目を入力し、本文と表示を確認してからレビューへ送ります。</span>
          </div>

          <div className="studio-file-actions">
            <input ref={importInput} hidden type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={(event) => void importMarkdown(event.target.files?.[0])} />
            <button className="dads-button" data-size="sm" data-type="outline" disabled={editorLocked} type="button" onClick={() => importInput.current?.click()}>MDを読み込む</button>
            <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={download}>Markdownを書き出す <Icon name="download" /></button>
          </div>

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
                <div><dt>送信ID</dt><dd><code>{attempt?.request.submissionId}</code></dd></div>
              </dl>
            </section>
          ) : null}

          <fieldset className="studio-form-fieldset" hidden={editorLocked}>
            <legend className="sr-only">記事情報</legend>
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

            <details className="studio-disclosure" open={metadataOpen} onToggle={(event) => setMetadataOpen(event.currentTarget.open)}>
              <summary>公開と分類</summary>
              <div className="studio-disclosure__content">
                {(() => {
                  const error = fieldError(visibleReviewIssues, "status", validationVisible);
                  return <Field id="article-status" label="公開状態" support="レビューとマージが完了するまで、公開サイトには反映されません。" error={error}>
                    <select id="article-status" required {...inputA11y("article-status", true, error)} value={frontmatter.status} onChange={(event) => update("status", event.target.value as ArticleFrontmatter["status"])}>
                      <option value="draft">下書き</option>
                      <option value="published">公開予定</option>
                      <option value="archived">非公開・保管</option>
                    </select>
                  </Field>;
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "authors", validationVisible);
                  return <Field id="article-authors" label="執筆者" support="複数の場合はカンマで区切ります。" error={error}>
                    <input id="article-authors" className="dads-input-text__input" required {...inputA11y("article-authors", true, error)} value={frontmatter.authors.join(", ")} onChange={(event) => update("authors", event.target.value.split(",").map((author) => author.trim()))} onBlur={() => update("authors", frontmatter.authors.filter(Boolean))} />
                  </Field>;
                })()}
                <div className="studio-field-row">
                  {(() => {
                    const error = fieldError(visibleReviewIssues, "publishedAt", validationVisible);
                    const required = frontmatter.status === "published";
                    return <Field id="article-published-at" label="公開日" required={required} support="公開予定の記事では必須です。" error={error}>
                      <input id="article-published-at" className="dads-input-text__input" type="date" required={required} {...inputA11y("article-published-at", true, error, false, required)} value={frontmatter.publishedAt ?? ""} onChange={(event) => update("publishedAt", event.target.value || undefined)} />
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
                  return <Field id="article-topic" label="テーマ" support="記事が扱う話題を選びます。" error={error}>
                    <select id="article-topic" required {...inputA11y("article-topic", true, error)} value={frontmatter.topics[0]} onChange={(event) => update("topics", [event.target.value as ArticleFrontmatter["topics"][number]])}>
                      {Object.entries(topicLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </Field>;
                })()}
                {(() => {
                  const error = fieldError(visibleReviewIssues, "tags", validationVisible);
                  return <Field id="article-tags" label="タグ" required={false} support="複数の場合はカンマで区切ります。" error={error}>
                    <input id="article-tags" className="dads-input-text__input" {...inputA11y("article-tags", true, error, false, false)} value={frontmatter.tags.join(", ")} onChange={(event) => update("tags", event.target.value.split(",").map((tag) => tag.trim()))} onBlur={() => update("tags", frontmatter.tags.filter(Boolean))} />
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
                {(() => {
                  const error = fieldError(visibleReviewIssues, "heroImage", validationVisible, "src");
                  return <Field id="article-hero-image" label="画像パス" required={false} support="/images/articles/ 以下のサイト内パスを指定します。" error={error}>
                    <input id="article-hero-image" className="dads-input-text__input" {...inputA11y("article-hero-image", true, error, false, false)} value={frontmatter.heroImage?.src ?? ""} onChange={(event) => update("heroImage", event.target.value ? { src: event.target.value, alt: frontmatter.heroImage?.alt ?? "" } : null)} placeholder="/images/articles/example.webp" />
                  </Field>;
                })()}
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

          <section ref={validationSection} id="article-validation" className={`studio-validation ${blockingErrorCount > 0 ? "has-errors" : "is-ready"}`} tabIndex={-1}>
            <h2>{blockingErrorCount === 0 ? <Icon name="check" /> : <Icon name="warning" />} 入力チェック</h2>
            {blockingErrorCount > 0 ? <p><strong>{blockingErrorCount}件</strong>の入力を確認するとレビューへ送れます。</p> : <p>レビュー依頼に必要な項目が揃っています。</p>}
            {validationVisible ? visibleSettingsIssues.slice(0, 10).map((issue, index) => (
              <button className="studio-validation__issue" key={`${issue.path.join(".")}-${issue.message}-${index}`} type="button" onClick={() => focusReviewIssue(issue)}>
                エラー — {issue.message}
              </button>
            )) : blockingErrorCount > 0 ? <p>レビューを依頼すると、確認が必要な項目をここに表示します。</p> : null}
            {validationVisible && visibleSettingsIssues.length > 10 ? (
              <p className="studio-validation__remaining">ほか{visibleSettingsIssues.length - 10}件あります。各入力欄のエラーも確認してください。</p>
            ) : null}
            {validationVisible ? visibleReviewIssues.filter((issue) => normalizedIssueField(issue) === "markdown" && bodyErrors.length === 0).map((issue, index) => (
              <button className="studio-validation__issue" key={`markdown-${issue.message}-${index}`} type="button" onClick={() => focusBodyIssue()}>
                エラー — 本文: {issue.message}
              </button>
            )) : null}
            {bodyIssues.map((issue) => (
              <button className={`studio-validation__issue ${issue.severity === "warning" ? "is-warning" : ""}`} key={`${issue.code}-${issue.line}-${issue.message}`} type="button" onClick={() => focusBodyIssue(issue)}>
                {issue.severity === "error" ? "エラー" : "確認"} — 本文{issue.line}行: {issue.message}
              </button>
            ))}
            {editorialWarnings.map((warning) => <p className="studio-validation__warning" key={warning}>確認 — {warning}</p>)}
          </section>

          <section aria-labelledby="article-review-heading" className="studio-review" ref={reviewSection} id="article-review" tabIndex={-1}>
            <p className="studio-review__eyebrow">GITHUB REVIEW</p>
            <h2 id="article-review-heading">レビューへ送る</h2>
            <p>新しい記事ファイルを作り、<code>develop</code>向けのDraft PRとして送ります。自動で公開・マージはされません。</p>

            {capabilityState.kind === "checking" ? <p className="studio-review__state" role="status">GitHub連携を確認中…</p> : null}
            {capabilityState.kind === "ready" && capabilityState.capabilities.publication.enabled ? (
              <p className="studio-review__state is-ready"><Icon name="check" /> 連携済み — {capabilityState.capabilities.identity.email}</p>
            ) : null}
            {capabilityState.kind === "ready" && !capabilityState.capabilities.publication.enabled ? (
              <p className="studio-review__state is-unavailable">この環境ではGitHub連携が無効です。Markdownの書き出しは利用できます。</p>
            ) : null}
            {capabilityState.kind === "unavailable" ? (
              <div className="studio-review__state is-unavailable">
                <p>GitHub連携の状態を確認できません。Markdownの書き出しは利用できます。</p>
                <button className="dads-button" data-size="sm" data-type="outline" type="button" onClick={() => setCapabilityRefresh((current) => current + 1)}>もう一度確認</button>
              </div>
            ) : null}

            {!attempt && !invalidAttemptStorage ? (
              <button
                className="dads-button studio-review__primary"
                data-size="lg"
                data-type="solid-fill"
                disabled={!capabilityEnabled || publicationBusy}
                onClick={requestReview}
                ref={reviewButton}
                type="button"
              >
                {publicationBusy ? "準備しています…" : "レビューを依頼"}
              </button>
            ) : null}

            {invalidAttemptStorage ? (
              <div className="studio-review__recovery">
                <h3>以前の送信記録を読み込めません</h3>
                <p>現在の入力内容は下書きとして残っています。読み込めない送信記録だけを削除すると、もう一度レビューを依頼できます。</p>
                <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void repairInvalidAttemptStorage()}>送信記録を修復</button>
              </div>
            ) : null}

            {publicationStatus?.kind === "pending" || publicationStatus?.kind === "outcomeUnknown" ? (
              <div className="studio-review__recovery">
                <h3>{publicationStatus.operation === "cancel" ? "取り消し結果の確認が必要です" : "送信結果の確認が必要です"}</h3>
                <p>内容を変更せず、同じ送信IDで状態を確認します。</p>
                {publicationStatus.operation === "cancel" ? (
                  <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void retryAttempt()}>取り消し結果を再確認</button>
                ) : (
                  <div className="studio-review__actions">
                    <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void retryAttempt()}>同じ内容で再確認</button>
                    <button className="dads-button" data-size="md" data-type="outline" disabled={publicationBusy} type="button" onClick={() => void cancelAttempt()}>依頼を取り消す</button>
                  </div>
                )}
              </div>
            ) : null}

            {publicationStatus?.kind === "failed" ? (
              <div className="studio-review__recovery">
                <h3>レビュー依頼を完了できませんでした</h3>
                <p>{publicationStatus.error.message}</p>
                {canAbandonAttempt ? <p>記事やPRを作成する前に停止したため、下の「新しい記事を開始」から安全に編集へ戻れます。</p> : null}
                {failedAttemptNeedsReload ? (
                  <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => window.location.reload()}>最新の状態を読み込む</button>
                ) : failedCancellation ? (
                  <div className="studio-review__actions">
                    <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void resumeAttempt()}>取り消しをやめて送信を続行</button>
                    {publicationStatus.error.retryable ? <button className="dads-button" data-size="md" data-type="outline" disabled={publicationBusy} type="button" onClick={() => void retryAttempt()}>取り消しを再試行</button> : null}
                  </div>
                ) : !canAbandonAttempt ? (
                  <div className="studio-review__actions">
                    <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void retryAttempt()}>同じ内容で再試行</button>
                    <button className="dads-button" data-size="md" data-type="outline" disabled={publicationBusy} type="button" onClick={() => void cancelAttempt()}>依頼を取り消す</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {publicationStatus?.kind === "succeeded" ? (
              <div className="studio-review__result">
                <h3>{publicationOutcomeLabel(publicationStatus.result)}</h3>
                {pullRequest ? (
                  <a className="dads-button" data-size="md" data-type="solid-fill" href={pullRequest.url} target="_blank" rel="noreferrer">
                    GitHubでレビューを開く <Icon name="external" />
                  </a>
                ) : null}
                {publicationStatus.result.outcome === "open" ? (
                  <button className="dads-button" data-size="md" data-type="outline" disabled={publicationBusy} type="button" onClick={() => void retryAttempt()}>PRの状態を再確認</button>
                ) : null}
                {publicationStatus.result.outcome === "cancelled" ? (
                  <button className="dads-button" data-size="md" data-type="solid-fill" disabled={publicationBusy} type="button" onClick={() => void resumeEditingAfterCancellation()}>編集を再開</button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="studio-danger-zone">
            <h2>新しい記事を作る</h2>
            <p>{invalidAttemptStorage
              ? "先にレビュー欄の「送信記録を修復」を実行してください。現在の下書きは保持されます。"
              : canAbandonAttempt
              ? "この送信は記事やPRを作成する前に停止しています。送信記録と現在の下書きを破棄できます。"
              : attempt && !attemptResult
                ? "まず現在のレビュー依頼を再確認するか取り消してください。"
                : "現在の入力内容と、このブラウザに保存した下書きを破棄します。"}</p>
            <button className="dads-button" data-size="sm" data-type="outline" disabled={!canStartNewArticle || publicationBusy} type="button" onClick={() => void resetDraft()}>新しい記事を開始</button>
          </section>
        </aside>

        <section
          aria-labelledby={compactLayout ? "studio-tab-write" : "editor-heading"}
          className={`studio-editor ${editorLocked ? "has-lock" : ""}`}
          hidden={compactLayout && activePane !== "write"}
          id="studio-pane-write"
          role={compactLayout ? "tabpanel" : undefined}
          tabIndex={compactLayout ? 0 : undefined}
        >
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>MARKDOWN</p><h2 id="editor-heading">本文を書く</h2></div>
            <div className="studio-editor__status">
              <span>{body.length.toLocaleString("ja-JP")}文字</span>
              {blockingErrorCount > 0 ? <button type="button" onClick={focusValidation} aria-controls="article-validation">入力エラー{blockingErrorCount}件を確認</button> : null}
            </div>
          </div>
          {editorLocked ? <p className="studio-editor__lock" role="status">送信内容を固定しています。本文は選択してコピーできます。</p> : null}
          <label className="sr-only" htmlFor="article-body">Markdown本文</label>
          <textarea
            aria-describedby="article-body-help"
            aria-errormessage={bodyInvalid ? "article-body-error" : undefined}
            aria-invalid={bodyInvalid || undefined}
            aria-required="true"
            aria-readonly={editorLocked}
            id="article-body"
            onChange={(event) => { if (!editorLocked) { setBody(event.target.value); setPublicationIssues([]); } }}
            placeholder="# はじめにではなく、H2（##）から本文を書き始めます"
            readOnly={editorLocked}
            required
            ref={bodyInput}
            spellCheck="true"
            value={body}
          />
          <p className="sr-only" id="article-body-help">Markdown形式で本文を入力します。H1見出しとraw HTMLは使用できません。</p>
          <p className="sr-only" id="article-body-error">{bodyErrorMessage ? `エラー — ${bodyErrorMessage}` : ""}</p>
        </section>

        <section
          aria-labelledby={compactLayout ? "studio-tab-preview" : "preview-heading"}
          className="studio-preview"
          hidden={compactLayout && activePane !== "preview"}
          id="studio-pane-preview"
          role={compactLayout ? "tabpanel" : undefined}
          tabIndex={compactLayout ? 0 : undefined}
        >
          <div className="studio-pane-title studio-pane-title--horizontal">
            <div><p>PREVIEW</p><h2 id="preview-heading">表示を確認</h2></div>
            <span className="studio-preview__status">自動更新</span>
          </div>
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
        </section>
      </main>

      <dialog aria-labelledby="review-dialog-title" className="studio-dialog" ref={confirmDialog} onClose={() => reviewButton.current?.focus()}>
        <form method="dialog">
          <p className="studio-review__eyebrow">GITHUB REVIEW</p>
          <h2 id="review-dialog-title">レビューへ送りますか？</h2>
          <p><strong>{frontmatter.title}</strong></p>
          <p>新しい記事として<code>develop</code>向けのDraft PRを作成します。公開やマージは行いません。</p>
          <div className="studio-dialog__actions">
            <button className="dads-button" data-size="md" data-type="outline" value="cancel">編集に戻る</button>
            <button className="dads-button" data-size="md" data-type="solid-fill" value="default" onClick={(event) => { event.preventDefault(); void submitReview(); }}>Draft PRを作成</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
