import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import MarkdownIt from "markdown-it";
import markdownItKatex from "markdown-it-katex";
import {
  extractMissingPythonModuleFromText,
  extractImportedPythonModules,
  normalizePythonModuleName,
  requestedHeavyPythonModules,
  stripHeavyPythonModules
} from "./python-runtime-routing";

type QuestionStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

type SourceReference = {
  notebookId: string;
  location: string;
};

type CachedAnswerSnapshot = {
  answerText: string;
  sourceReferences: SourceReference[];
  tokensUsed: number;
  modelId: string;
  timestamp: string;
};

type AuthUser = {
  userId: string;
  email: string | null;
  groups: string[];
};

type QuestionItem = {
  questionId: string;
  userId: string;
  notebookId: string;
  sectionId: string;
  sessionId?: string;
  questionText: string;
  questionHash: string;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
  attempts?: number;
  lastError?: string;
};

type AnswerItem = {
  questionId: string;
  answerText: string;
  sourceReferences: SourceReference[];
  tokensPrompt: number;
  tokensCompletion: number;
  modelId: string;
  latencyMs: number;
  createdAt: string;
  updatedAt: string;
};

type NotebookChunk = {
  sectionId: string;
  content: string;
  position: number;
};

type NotebookRecord = {
  notebookId: string;
  title: string;
  chapterId?: string;
  chapter: string;
  chapterOrder?: number;
  audience?: "beginner" | "advanced";
  sortOrder: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
  videoUrl?: string;
  source?: {
    kind: "noema-original" | "open-license-translation";
    provider: string;
    license: string;
    originalTitle?: string;
    originalUrl?: string;
    translationLanguage?: string;
  };
  chunks?: NotebookChunk[];
  createdAt?: string;
  updatedAt?: string;
};

function openAIResponsesSupportsTemperature(modelId: string): boolean {
  return !/^gpt-5([-.]|$)/i.test(modelId.trim());
}

type AdminNotebookPatchInput = {
  notebookId: string;
  title?: string;
  chapter?: string;
  sortOrder?: number;
  tags?: string[];
  colabUrl?: string;
  videoUrl?: string;
};

type AdminNotebookPutInput = {
  title?: string;
  chapter?: string;
  sortOrder?: number;
  tags?: string[];
  colabUrl?: string;
  videoUrl?: string;
  ipynbRaw?: string;
};

type AdminNotebookLlmPatchInput = {
  instruction: string;
  selectedText?: string;
};

type AdminNotebookPreviewInput = {
  notebookId?: string;
  ipynbRaw: string;
};

type NotebookColabSessionInput = {
  ipynbRaw: string;
};

type NotebookColabSessionResult = {
  notebookPath: string;
  notebookUrl: string;
};

const DYNAMODB_ITEM_SOFT_LIMIT_BYTES = 350_000;
const MAX_CHUNK_CHARACTERS = 1_200;

type ModelProvider = "openai" | "bedrock" | "mock";

type ModelSelection = {
  provider: ModelProvider;
  modelId: string;
};

type ModelResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

type AskQuestionInput = {
  notebookId: string;
  sectionId: string;
  questionText: string;
};

type ChatProvider = "openai" | "gemini" | "bedrock";

type ChatCompleteInput = {
  notebookId: string;
  sectionId: string;
  questionText: string;
  sessionId?: string;
  provider: ChatProvider;
  modelId?: string;
  apiKey?: string;
};

type ChatCompleteResult = {
  answerText: string;
  sourceReferences: SourceReference[];
  tokensUsed: number;
  sessionId: string;
  provider: ChatProvider;
  modelId: string;
  bedrockRemainingToday: number | null;
};

type AskQuestionResult = {
  questionId: string;
  status: QuestionStatus;
  cached: boolean;
};

type LearningProgressNotebookRecord = {
  visits: number;
  lastVisitedAt: string;
  completed: boolean;
  completedAt: string;
  checkPassed?: boolean;
  checkPassedAt?: string;
  checkBestScore?: number;
  checkAttempts?: number;
};

type LearningProgressChapterRecord = {
  finalPassed: boolean;
  finalPassedAt: string;
  finalBestScore: number;
  finalMaxScore: number;
  finalAttempts: number;
};

type LearningProgressStore = {
  schemaVersion: 3;
  notebooks: Record<string, LearningProgressNotebookRecord>;
  chapters: Record<string, LearningProgressChapterRecord>;
};

type PythonRuntimeExecuteInput = {
  notebookId: string;
  sectionId: string;
  code: string;
  contextCode?: string;
  expectedModules: string[];
};

type PythonRuntimePreloadInput = {
  notebookId: string;
  expectedModules: string[];
};

type PythonRuntimeExecuteResult = {
  stdout: string;
  stderr: string;
  error: string | null;
  errorCode: string | null;
  retryable: boolean;
  durationMs: number;
  timedOut: boolean;
  installedPackages: string[];
  outputs: PythonRuntimeOutput[];
};

type PythonRuntimeOutput =
  | {
      type: "text/plain";
      text: string;
    }
  | {
      type: "text/html";
      html: string;
    }
  | {
      type: "image/png";
      data: string;
      alt?: string;
    };

type PythonRunnerInvokeResponse = Record<string, unknown> & {
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
  errorCode?: unknown;
  retryable?: unknown;
  durationMs?: unknown;
  timedOut?: unknown;
  installedPackages?: unknown;
  failedModules?: unknown;
  outputs?: unknown;
  ok?: unknown;
};

type GetAnswerResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "pending"; status: QuestionStatus }
  | { kind: "failed"; status: QuestionStatus; message: string }
  | {
      kind: "completed";
      status: QuestionStatus;
      answer: {
        answerText: string;
        sourceReferences: SourceReference[];
        tokensUsed: number;
        timestamp: string;
      };
    };

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const sqs = new SQSClient({});
const s3 = new S3Client({});
const ssm = new SSMClient({});
const lambdaClient = new LambdaClient({});

const bedrockRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION;
const bedrockClient = bedrockRegion ? new BedrockRuntimeClient({ region: bedrockRegion }) : null;
const ALLOWED_BEDROCK_MODEL_IDS = new Set(["amazon.nova-micro-v1:0", "amazon.nova-lite-v1:0"]);

const QUESTIONS_TABLE = requiredEnv("QUESTIONS_TABLE");
const ANSWERS_TABLE = requiredEnv("ANSWERS_TABLE");
const CACHE_TABLE = requiredEnv("CACHE_TABLE");
const RATE_LIMIT_TABLE = requiredEnv("RATE_LIMIT_TABLE");
const NOTEBOOKS_TABLE = requiredEnv("NOTEBOOKS_TABLE");
const USER_PROGRESS_TABLE = requiredEnv("USER_PROGRESS_TABLE");
const ACCESS_LOGS_TABLE = process.env.ACCESS_LOGS_TABLE || "";
const QA_QUEUE_URL = process.env.QA_QUEUE_URL || "";
const NOTEBOOK_BUCKET = process.env.NOTEBOOK_BUCKET || "";
const COLAB_NOTEBOOK_BASE_URL = String(process.env.COLAB_NOTEBOOK_BASE_URL || "").trim().replace(/\/+$/, "");
const PYTHON_RUNNER_FUNCTION_NAME = process.env.PYTHON_RUNNER_FUNCTION_NAME || "";
const PYTHON_RUNNER_HEAVY_FUNCTION_NAME = process.env.PYTHON_RUNNER_HEAVY_FUNCTION_NAME || "";
const MAX_RUNTIME_CODE_CHARS = 120_000;
const MAX_RUNTIME_CONTEXT_CODE_CHARS = 120_000;
const ASSISTANT_INPUT_MAX_CHARS = 4000;
const ASSISTANT_RESPONSE_MAX_CHARS = 8000;
const ASSISTANT_REQUEST_BODY_MAX_CHARS = 12000;
const CHAPTER_FINAL_ANSWER_MAX_CHARS = 2000;
const CHAPTER_FINAL_REQUEST_BODY_MAX_CHARS = 25000;
const COLAB_GITHUB_REPO = (process.env.COLAB_GITHUB_REPO || "mani1261790/Noema").trim();
const COLAB_GITHUB_REF = (process.env.COLAB_GITHUB_REF || "main").trim();
const CONTENT_WRITE_MODE_RAW = (process.env.CONTENT_WRITE_MODE || "github_ssot").trim().toLowerCase();
const CONTENT_GITHUB_REPO = (process.env.CONTENT_GITHUB_REPO || COLAB_GITHUB_REPO).trim();
const CONTENT_GITHUB_REF = (process.env.CONTENT_GITHUB_REF || COLAB_GITHUB_REF).trim();

type ContentWritePolicy = {
  mode: string;
  canWrite: boolean;
  canCreate: boolean;
  githubRepo: string;
  githubRef: string;
};

async function streamBodyToString(body: unknown): Promise<string> {
  if (!body || typeof body !== "object") return "";
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalEmailCandidates(value: string): string[] {
  const normalized = normalizeEmailAddress(value);
  if (!normalized || !normalized.includes("@")) {
    return normalized ? [normalized] : [];
  }

  const [localPartRaw, domainRaw] = normalized.split("@");
  const localPart = localPartRaw.trim();
  const domain = domainRaw.trim();
  if (!localPart || !domain) {
    return [normalized];
  }

  const candidates = new Set<string>([`${localPart}@${domain}`]);
  const plusLessLocal = localPart.replace(/\+.*/, "");
  if (plusLessLocal) {
    candidates.add(`${plusLessLocal}@${domain}`);
  }

  if (domain === "gmail.com" || domain === "googlemail.com") {
    const dotLess = plusLessLocal.replace(/\./g, "");
    if (dotLess) {
      candidates.add(`${dotLess}@gmail.com`);
    }
  }

  return Array.from(candidates);
}

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .flatMap((value) => canonicalEmailCandidates(value))
    .filter(Boolean)
);

const INLINE_QA = (process.env.NOEMA_INLINE_QA || "false").toLowerCase() === "true";
const QA_RATE_LIMIT_MAX = parsePositiveInt(process.env.QA_RATE_LIMIT_MAX, 6);
const QA_RATE_LIMIT_WINDOW_MINUTES = parsePositiveInt(process.env.QA_RATE_LIMIT_WINDOW_MINUTES, 1);
const BEDROCK_DAILY_LIMIT = parsePositiveInt(process.env.BEDROCK_DAILY_LIMIT, 10);

let openAiApiKeyPromise: Promise<string | null> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function epochSeconds(daysFromNow: number): number {
  return Math.floor(Date.now() / 1000) + daysFromNow * 24 * 60 * 60;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeQuestion(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function questionHash(input: string): string {
  return crypto.createHash("sha256").update(normalizeQuestion(input)).digest("hex");
}

function toCacheKey(hash: string, notebookId: string, sectionId: string): string {
  return `${hash}:${notebookId}:${sectionId}`;
}

function tokenize(value: string): string[] {
  return normalizeQuestion(value)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 1);
}

function scoreChunk(questionTokens: string[], content: string): number {
  const hay = normalizeQuestion(content);
  let score = 0;
  for (const token of questionTokens) {
    if (hay.includes(token)) score += 1;
  }
  return score;
}

function parseJson<T>(event: APIGatewayProxyEventV2): T | null {
  const raw = getEventBodyText(event);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getEventBodyText(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  try {
    return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  } catch {
    return "";
  }
}

export function eventBodyTooLarge(event: APIGatewayProxyEventV2, maxChars: number): boolean {
  return getEventBodyText(event).length > maxChars;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
  }

  const text = asString(raw).trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
      }
    } catch {
      // falls back to comma-split.
    }
  }

  return text
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export function getAuthUser(event: APIGatewayProxyEventV2): AuthUser | null {
  const requestContext = event.requestContext as APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = requestContext.authorizer?.jwt?.claims;
  if (!claims) return null;

  const userId = asString(claims.sub || claims.username);
  if (!userId) return null;

  const email =
    asString(claims.email || "") ||
    asString(claims["custom:email"] || "") ||
    asString(claims.preferred_username || "") ||
    asString(claims["cognito:username"] || "") ||
    asString(claims.username || "") ||
    null;
  const groups = parseGroups(claims["cognito:groups"]);

  return { userId, email, groups };
}

export function isAdmin(user: AuthUser): boolean {
  if (user.groups.includes("admin")) return true;

  if (user.email) {
    const candidates = canonicalEmailCandidates(user.email);
    for (const candidate of candidates) {
      if (ADMIN_EMAILS.has(candidate)) {
        return true;
      }
    }
  }
  return false;
}

function validateAskQuestionInput(payload: unknown): AskQuestionInput | null {
  if (!payload || typeof payload !== "object") return null;
  const input = payload as Record<string, unknown>;

  const notebookId = asString(input.notebookId).trim();
  const sectionId = asString(input.sectionId).trim();
  const questionText = asString(input.questionText).trim();

  if (!notebookId || !sectionId || !questionText) return null;
  if (questionText.length > ASSISTANT_INPUT_MAX_CHARS) return null;

  return { notebookId, sectionId, questionText };
}

function validateChapterFinalAnswerMap(answers: Record<string, unknown>): string | null {
  if (!answers || typeof answers !== "object") {
    return "Invalid answers payload.";
  }
  for (const [questionId, value] of Object.entries(answers)) {
    if (typeof value !== "string") {
      return `Answer for ${questionId} must be a string.`;
    }
    if (value.length > CHAPTER_FINAL_ANSWER_MAX_CHARS) {
      return `Answer for ${questionId} exceeds ${CHAPTER_FINAL_ANSWER_MAX_CHARS} characters.`;
    }
  }
  return null;
}

function sanitizeChapterFinalAnswerMap(answers: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!answers || typeof answers !== "object") return sanitized;
  for (const [questionId, value] of Object.entries(answers)) {
    sanitized[String(questionId)] = asString(value).trim().slice(0, CHAPTER_FINAL_ANSWER_MAX_CHARS);
  }
  return sanitized;
}

function normalizeAssistantAnswerText(value: string): string {
  const text = asString(value).trim();
  if (text.length <= ASSISTANT_RESPONSE_MAX_CHARS) return text;
  const suffix = "\n\n[回答は長すぎたため末尾を省略しました]";
  return `${text.slice(0, Math.max(0, ASSISTANT_RESPONSE_MAX_CHARS - suffix.length)).trimEnd()}${suffix}`;
}

function createEmptyLearningProgressStore(): LearningProgressStore {
  return {
    schemaVersion: 3,
    notebooks: {},
    chapters: {}
  };
}

function normalizeLearningProgressRecord(raw: unknown): LearningProgressNotebookRecord {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallbackIso = nowIso();
  const visitsRaw = Number(value.visits);
  const checkPassed = Boolean(value.checkPassed || value.completed);
  const completed = Boolean(value.completed || checkPassed);
  const checkBestScoreRaw = Number(value.checkBestScore);
  const checkAttemptsRaw = Number(value.checkAttempts);
  return {
    visits: Number.isFinite(visitsRaw) && visitsRaw >= 0 ? Math.floor(visitsRaw) : 0,
    lastVisitedAt: toIsoOrFallback(value.lastVisitedAt, fallbackIso),
    completed,
    completedAt: completed ? toIsoOrFallback(value.completedAt || value.lastVisitedAt, fallbackIso) : "",
    checkPassed,
    checkPassedAt: checkPassed ? toIsoOrFallback(value.checkPassedAt || value.completedAt || value.lastVisitedAt, fallbackIso) : "",
    checkBestScore: Number.isFinite(checkBestScoreRaw) && checkBestScoreRaw >= 0 ? Math.floor(checkBestScoreRaw) : 0,
    checkAttempts: Number.isFinite(checkAttemptsRaw) && checkAttemptsRaw >= 0 ? Math.floor(checkAttemptsRaw) : 0
  };
}

function normalizeLearningProgressChapterRecord(raw: unknown): LearningProgressChapterRecord {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallbackIso = nowIso();
  const finalBestScoreRaw = Number(value.finalBestScore);
  const finalMaxScoreRaw = Number(value.finalMaxScore);
  const finalAttemptsRaw = Number(value.finalAttempts);
  const finalPassed = Boolean(value.finalPassed);
  return {
    finalPassed,
    finalPassedAt: finalPassed ? toIsoOrFallback(value.finalPassedAt, fallbackIso) : "",
    finalBestScore: Number.isFinite(finalBestScoreRaw) && finalBestScoreRaw >= 0 ? Math.floor(finalBestScoreRaw) : 0,
    finalMaxScore: Number.isFinite(finalMaxScoreRaw) && finalMaxScoreRaw >= 0 ? Math.floor(finalMaxScoreRaw) : 0,
    finalAttempts: Number.isFinite(finalAttemptsRaw) && finalAttemptsRaw >= 0 ? Math.floor(finalAttemptsRaw) : 0
  };
}

function normalizeLearningProgressStore(raw: unknown): LearningProgressStore {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const notebooksRaw =
    parsed.notebooks && typeof parsed.notebooks === "object"
      ? (parsed.notebooks as Record<string, unknown>)
      : {};
  const chaptersRaw =
    parsed.chapters && typeof parsed.chapters === "object"
      ? (parsed.chapters as Record<string, unknown>)
      : {};
  const notebooks: Record<string, LearningProgressNotebookRecord> = {};
  const chapters: Record<string, LearningProgressChapterRecord> = {};

  Object.entries(notebooksRaw).forEach(([notebookId, value]) => {
    const trimmedId = String(notebookId || "").trim();
    if (!trimmedId) return;
    notebooks[trimmedId] = normalizeLearningProgressRecord(value);
  });

  Object.entries(chaptersRaw).forEach(([chapterId, value]) => {
    const trimmedId = String(chapterId || "").trim();
    if (!trimmedId) return;
    chapters[trimmedId] = normalizeLearningProgressChapterRecord(value);
  });

  return {
    schemaVersion: 3,
    notebooks,
    chapters
  };
}

function toIsoOrFallback(raw: unknown, fallbackIso: string): string {
  const value = asString(raw).trim();
  if (!value) return fallbackIso;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallbackIso;
  return new Date(parsed).toISOString();
}

async function getLearningProgressStoreForUser(userId: string): Promise<LearningProgressStore> {
  const response = await ddb.send(
    new GetCommand({
      TableName: USER_PROGRESS_TABLE,
      Key: { userId }
    })
  );

  return normalizeLearningProgressStore(response.Item);
}

export async function getLearningProgress(user: AuthUser) {
  return getLearningProgressStoreForUser(user.userId);
}

export async function putLearningProgress(
  user: AuthUser,
  notebookId: string,
  record: LearningProgressNotebookRecord
): Promise<LearningProgressStore> {
  const trimmedNotebookId = String(notebookId || "").trim();
  if (!trimmedNotebookId) {
    throw new Error("notebookId is required");
  }

  const nextRecord = normalizeLearningProgressRecord(record);
  const existingStore = await getLearningProgressStoreForUser(user.userId);
  const nextStore = normalizeLearningProgressStore({
    ...existingStore,
    notebooks: {
      ...existingStore.notebooks,
      [trimmedNotebookId]: nextRecord
    }
  });
  const timestamp = nowIso();

  await ddb.send(
    new PutCommand({
      TableName: USER_PROGRESS_TABLE,
      Item: {
        userId: user.userId,
        schemaVersion: 3,
        notebooks: nextStore.notebooks,
        chapters: nextStore.chapters,
        updatedAt: timestamp
      }
    })
  );

  return nextStore;
}

export async function putChapterLearningProgress(
  user: AuthUser,
  chapterId: string,
  record: LearningProgressChapterRecord
): Promise<LearningProgressStore> {
  const trimmedChapterId = String(chapterId || "").trim();
  if (!trimmedChapterId) {
    throw new Error("chapterId is required");
  }

  const nextRecord = normalizeLearningProgressChapterRecord(record);
  const existingStore = await getLearningProgressStoreForUser(user.userId);
  const nextStore = normalizeLearningProgressStore({
    ...existingStore,
    chapters: {
      ...existingStore.chapters,
      [trimmedChapterId]: nextRecord
    }
  });
  const timestamp = nowIso();

  await ddb.send(
    new PutCommand({
      TableName: USER_PROGRESS_TABLE,
      Item: {
        userId: user.userId,
        schemaVersion: 3,
        notebooks: nextStore.notebooks,
        chapters: nextStore.chapters,
        updatedAt: timestamp
      }
    })
  );

  return nextStore;
}

async function putAccessLog(userId: string, notebookId: string, action: string) {
  if (!ACCESS_LOGS_TABLE) return;
  await ddb
    .send(
      new PutCommand({
        TableName: ACCESS_LOGS_TABLE,
        Item: {
          logId: crypto.randomUUID(),
          userId,
          notebookId,
          action,
          createdAt: nowIso(),
          expiresAt: epochSeconds(30)
        }
      })
    )
    .catch(() => undefined);
}

async function assertQuestionRateLimitAvailable(userId: string) {
  const now = new Date();
  const windowMs = QA_RATE_LIMIT_WINDOW_MINUTES * 60_000;
  const from = new Date(now.getTime() - windowMs).toISOString();

  const response = await ddb.send(
    new QueryCommand({
      TableName: RATE_LIMIT_TABLE,
      KeyConditionExpression: "userId = :userId AND requestAt >= :from",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":from": from
      },
      Select: "COUNT",
      Limit: QA_RATE_LIMIT_MAX + 1,
      ConsistentRead: true
    })
  );

  if ((response.Count ?? 0) >= QA_RATE_LIMIT_MAX) {
    throw new Error("Rate limit exceeded. Please wait and retry.");
  }
}

async function recordQuestionRateLimitUsage(userId: string) {
  const now = new Date();
  const windowMs = QA_RATE_LIMIT_WINDOW_MINUTES * 60_000;
  const requestAt = `${now.toISOString()}#${crypto.randomUUID()}`;
  const expiresAt = Math.floor((now.getTime() + windowMs * 2) / 1000);

  await ddb.send(
    new PutCommand({
      TableName: RATE_LIMIT_TABLE,
      Item: {
        userId,
        requestAt,
        expiresAt
      }
    })
  );
}

function jstDayStart(now: Date): Date {
  const jstMillis = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMillis);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const date = jst.getUTCDate();
  return new Date(Date.UTC(year, month, date, -9, 0, 0, 0));
}

function jstDayKey(now: Date) {
  const jstMillis = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMillis);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const date = String(jst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

async function acquireBedrockDailySlot(scopeUserId: string) {
  const now = new Date();
  const dayStart = jstDayStart(now);
  const dayKey = `DAY#${jstDayKey(now)}`;
  const expiresAt = Math.floor((dayStart.getTime() + 3 * 24 * 60 * 60 * 1000) / 1000);
  const response = await ddb.send(
    new UpdateCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: {
        userId: scopeUserId,
        requestAt: dayKey
      },
      UpdateExpression: "SET expiresAt = :expiresAt, usageCount = if_not_exists(usageCount, :zero) + :inc",
      ConditionExpression: "attribute_not_exists(usageCount) OR usageCount < :limit",
      ExpressionAttributeValues: {
        ":expiresAt": expiresAt,
        ":zero": 0,
        ":inc": 1,
        ":limit": BEDROCK_DAILY_LIMIT
      },
      ReturnValues: "ALL_NEW"
    })
  );

  const usageCount = Number(response.Attributes?.usageCount ?? 0);
  return Math.max(0, BEDROCK_DAILY_LIMIT - usageCount);
}

async function releaseBedrockDailySlot(scopeUserId: string) {
  const dayKey = `DAY#${jstDayKey(new Date())}`;
  await ddb
    .send(
      new UpdateCommand({
        TableName: RATE_LIMIT_TABLE,
        Key: {
          userId: scopeUserId,
          requestAt: dayKey
        },
        UpdateExpression: "SET usageCount = if_not_exists(usageCount, :zero) - :dec",
        ConditionExpression: "attribute_exists(usageCount) AND usageCount > :zero",
        ExpressionAttributeValues: {
          ":zero": 0,
          ":dec": 1
        }
      })
    )
    .catch(() => undefined);
}

async function getNotebook(notebookId: string): Promise<NotebookRecord | null> {
  const response = await ddb.send(
    new GetCommand({
      TableName: NOTEBOOKS_TABLE,
      Key: { notebookId }
    })
  );

  return normalizeNotebookRecord(response.Item);
}

async function getQuestion(questionId: string): Promise<QuestionItem | null> {
  const response = await ddb.send(
    new GetCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId }
    })
  );

  return (response.Item as QuestionItem | undefined) ?? null;
}

async function getAnswer(questionId: string): Promise<AnswerItem | null> {
  const response = await ddb.send(
    new GetCommand({
      TableName: ANSWERS_TABLE,
      Key: { questionId }
    })
  );

  return (response.Item as AnswerItem | undefined) ?? null;
}

function toSnapshot(
  answerText: string,
  sourceReferences: SourceReference[],
  tokensPrompt: number,
  tokensCompletion: number,
  modelId: string
): CachedAnswerSnapshot {
  return {
    answerText,
    sourceReferences,
    tokensUsed: tokensPrompt + tokensCompletion,
    modelId,
    timestamp: nowIso()
  };
}

async function putCachedAnswer(cacheKey: string, snapshot: CachedAnswerSnapshot) {
  await ddb.send(
    new PutCommand({
      TableName: CACHE_TABLE,
      Item: {
        cacheKey,
        answerSnapshot: snapshot,
        expiresAt: epochSeconds(7)
      }
    })
  );
}

async function upsertAnswer(item: AnswerItem) {
  await ddb.send(
    new PutCommand({
      TableName: ANSWERS_TABLE,
      Item: item
    })
  );
}

async function persistCompletedChat(
  input: ChatCompleteInput,
  user: AuthUser,
  answerText: string,
  sourceReferences: SourceReference[],
  tokensUsed: number,
  modelId: string
) {
  const normalizedAnswerText = normalizeAssistantAnswerText(answerText || "");
  const questionId = crypto.randomUUID();
  const sessionId = input.sessionId?.trim() || crypto.randomUUID();
  const createdAt = nowIso();
  const normalizedModelId = `${input.provider}:${modelId}`;
  const hash = questionHash(`${input.provider}:${input.questionText}`);

  await ddb.send(
    new PutCommand({
      TableName: QUESTIONS_TABLE,
      Item: {
        questionId,
        userId: user.userId,
        userEmail: user.email,
        notebookId: input.notebookId,
        sectionId: input.sectionId,
        sessionId,
        questionText: input.questionText,
        questionHash: hash,
        status: "COMPLETED",
        attempts: 1,
        createdAt,
        updatedAt: createdAt
      }
    })
  );

  await upsertAnswer({
      questionId,
    answerText: normalizedAnswerText,
      sourceReferences,
      tokensPrompt: tokensUsed,
    tokensCompletion: 0,
    modelId: normalizedModelId,
    latencyMs: 0,
      createdAt,
      updatedAt: createdAt
    });

  return sessionId;
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;

  if (typeof data.output_text === "string") {
    return data.output_text.trim();
  }

  if (Array.isArray(data.output)) {
    const chunks: string[] = [];
    for (const item of data.output) {
      if (!item || typeof item !== "object") continue;
      const message = item as Record<string, unknown>;
      if (!Array.isArray(message.content)) continue;
      for (const contentItem of message.content) {
        if (!contentItem || typeof contentItem !== "object") continue;
        const content = contentItem as Record<string, unknown>;
        if (typeof content.text === "string" && content.text.trim()) {
          chunks.push(content.text.trim());
        }
      }
    }

    if (chunks.length > 0) {
      return chunks.join("\n");
    }
  }

  if (Array.isArray(data.choices)) {
    const first = data.choices[0] as { message?: { content?: string }; text?: string } | undefined;
    if (first?.message?.content) return first.message.content.trim();
    if (first?.text) return first.text.trim();
  }

  return "";
}

async function getOpenAiApiKey(): Promise<string | null> {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return process.env.OPENAI_API_KEY.trim();
  }

  if (!process.env.OPENAI_API_KEY_SSM_PARAMETER?.trim()) {
    return null;
  }

  if (!openAiApiKeyPromise) {
    openAiApiKeyPromise = ssm
      .send(
        new GetParameterCommand({
          Name: process.env.OPENAI_API_KEY_SSM_PARAMETER.trim(),
          WithDecryption: true
        })
      )
      .then((result) => result.Parameter?.Value?.trim() || null)
      .catch(() => null);
  }

  return openAiApiKeyPromise;
}

function resolveProvider(): ModelProvider {
  const explicit = (process.env.QA_MODEL_PROVIDER || "").trim().toLowerCase();
  if (explicit === "openai" || explicit === "bedrock" || explicit === "mock") {
    return explicit;
  }

  if (process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_SSM_PARAMETER) {
    return "openai";
  }

  if (process.env.BEDROCK_MODEL_SMALL || process.env.BEDROCK_MODEL_MID || process.env.BEDROCK_MODEL_LARGE) {
    return "bedrock";
  }

  return "mock";
}

function modelCandidates(provider: ModelProvider) {
  if (provider === "openai") {
    const small = process.env.OPENAI_MODEL_SMALL?.trim() || "gpt-5-nano";
    const mid = process.env.OPENAI_MODEL_MID?.trim() || small;
    const large = process.env.OPENAI_MODEL_LARGE?.trim() || mid;
    return { small, mid, large };
  }

  if (provider === "bedrock") {
    const small = process.env.BEDROCK_MODEL_SMALL?.trim() || "";
    const mid = process.env.BEDROCK_MODEL_MID?.trim() || "";
    const large = process.env.BEDROCK_MODEL_LARGE?.trim() || "";
    return { small, mid, large };
  }

  return { small: "", mid: "", large: "" };
}

function routeModel(questionText: string, contextChars: number): ModelSelection {
  const provider = resolveProvider();
  if (provider === "mock") {
    return { provider: "mock", modelId: "mock" };
  }

  const { small, mid, large } = modelCandidates(provider);
  const pickSmall = questionText.length < 120 && small;
  const pickLarge = contextChars > 2800 && large;
  const chosen = pickSmall || pickLarge || mid || small || large;

  if (!chosen) {
    return { provider: "mock", modelId: "mock" };
  }

  return { provider, modelId: chosen };
}

function resolveBedrockModelId(requestedModelId: string, questionText: string, prompt: string) {
  const explicitModel = requestedModelId.trim();
  if (explicitModel) {
    if (!ALLOWED_BEDROCK_MODEL_IDS.has(explicitModel)) {
      throw new Error(`Unsupported Bedrock model: ${explicitModel}`);
    }
    return explicitModel;
  }

  const selectedModel = routeModel(questionText, prompt.length);
  const fallbackModel =
    (selectedModel.provider === "bedrock" ? selectedModel.modelId : "") ||
    process.env.BEDROCK_MODEL_SMALL?.trim() ||
    "";

  if (!fallbackModel) {
    throw new Error("Bedrock model is not configured. Set BEDROCK_MODEL_SMALL in Deploy Infra.");
  }

  if (!ALLOWED_BEDROCK_MODEL_IDS.has(fallbackModel)) {
    throw new Error(`Unsupported Bedrock model: ${fallbackModel}`);
  }

  return fallbackModel;
}

async function callOpenAI(prompt: string, modelId: string): Promise<ModelResponse> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or OPENAI_API_KEY_SSM_PARAMETER) is not configured.");
  }
  return callOpenAIWithKey(prompt, modelId, apiKey);
}

async function callOpenAIWithKey(prompt: string, modelId: string, apiKey: string): Promise<ModelResponse> {
  if (!apiKey.trim()) {
    throw new Error("OpenAI API key is required.");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || process.env.BEDROCK_MAX_TOKENS || 800);
  const temperature = Number(process.env.OPENAI_TEMPERATURE || 0.2);
  const body: Record<string, unknown> = {
    model: modelId,
    input: prompt,
    max_output_tokens: maxOutputTokens
  };
  if (openAIResponsesSupportsTemperature(modelId)) {
    body.temperature = temperature;
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const usage = (payload.usage as Record<string, unknown> | undefined) ?? {};

  return {
    text: extractOpenAIText(payload),
    inputTokens: toNumber(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: toNumber(usage.output_tokens ?? usage.completion_tokens)
  };
}

async function callGeminiWithKey(prompt: string, modelId: string, apiKey: string): Promise<ModelResponse> {
  if (!apiKey.trim()) {
    throw new Error("Gemini API key is required.");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: Number(process.env.OPENAI_TEMPERATURE || 0.2),
          maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || process.env.BEDROCK_MAX_TOKENS || 800)
        }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const firstCandidate = candidates[0] as Record<string, unknown> | undefined;
  const content = firstCandidate && typeof firstCandidate.content === "object" ? firstCandidate.content as Record<string, unknown> : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  const text = parts
    .map((item) => (item && typeof item === "object" ? asString((item as Record<string, unknown>).text) : ""))
    .join("\n")
    .trim();
  const usage = payload.usageMetadata && typeof payload.usageMetadata === "object"
    ? payload.usageMetadata as Record<string, unknown>
    : {};

  return {
    text,
    inputTokens: toNumber(usage.promptTokenCount),
    outputTokens: toNumber(usage.candidatesTokenCount ?? usage.totalTokenCount)
  };
}

async function callBedrock(prompt: string, modelId: string): Promise<ModelResponse> {
  if (!bedrockClient) {
    throw new Error("BEDROCK_REGION is not configured.");
  }

  let response;
  try {
    response = await bedrockClient.send(
      new ConverseCommand({
        modelId,
        messages: [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: {
          maxTokens: Number(process.env.BEDROCK_MAX_TOKENS || 800),
          temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.2)
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("model identifier is invalid")) {
      throw new Error(`Bedrock model identifier is invalid: ${modelId} (region: ${bedrockRegion || "unknown"})`);
    }
    throw error;
  }

  const text =
    response.output?.message?.content
      ?.map((item) => ("text" in item ? item.text || "" : ""))
      .join("\n")
      .trim() ?? "";

  return {
    text,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0
  };
}

function fallbackAnswer(questionText: string, contexts: string[]) {
  return [
    "開発モード回答です。LLMが未設定のため教材文脈から要点を返します。",
    `質問: ${questionText}`,
    "関連コンテキスト:",
    ...contexts.map((text, index) => `${index + 1}. ${text.slice(0, 220)}`),
    "次の一歩:",
    "- Colabでノートを実行し、変数を変えて挙動を確認してください。"
  ].join("\n");
}

type LineDiffOp =
  | { kind: "equal"; line: string }
  | { kind: "add"; line: string }
  | { kind: "remove"; line: string };

function extractFirstJsonObject(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  let start = text.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = false;
        }
        continue;
      }

      if (ch === "\"") {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
        continue;
      }

      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }

    start = text.indexOf("{", start + 1);
  }

  return "";
}

function parseAdminPatchModelOutput(raw: string): { summary: string; notebook: NotebookFile } | null {
  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const summary = asString(record.summary).trim();

  const notebookCandidate = record.ipynb ?? record.notebook ?? parsed;
  if (!notebookCandidate || typeof notebookCandidate !== "object") {
    return null;
  }

  const notebook = notebookCandidate as NotebookFile;
  if (!Array.isArray(notebook.cells)) {
    return null;
  }

  return {
    summary,
    notebook
  };
}

function computeLineDiff(beforeLines: string[], afterLines: string[]): LineDiffOp[] {
  const rows = beforeLines.length;
  const cols = afterLines.length;
  const width = cols + 1;
  const matrixCells = (rows + 1) * (cols + 1);

  if (matrixCells > 3_000_000) {
    const output: LineDiffOp[] = [];
    for (const line of beforeLines) output.push({ kind: "remove", line });
    for (const line of afterLines) output.push({ kind: "add", line });
    return output;
  }

  const lcs = new Uint32Array(matrixCells);
  const at = (r: number, c: number) => r * width + c;

  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      if (beforeLines[r] === afterLines[c]) {
        lcs[at(r, c)] = lcs[at(r + 1, c + 1)] + 1;
      } else {
        const down = lcs[at(r + 1, c)];
        const right = lcs[at(r, c + 1)];
        lcs[at(r, c)] = down >= right ? down : right;
      }
    }
  }

  const output: LineDiffOp[] = [];
  let r = 0;
  let c = 0;

  while (r < rows && c < cols) {
    if (beforeLines[r] === afterLines[c]) {
      output.push({ kind: "equal", line: beforeLines[r] });
      r += 1;
      c += 1;
      continue;
    }

    const down = lcs[at(r + 1, c)];
    const right = lcs[at(r, c + 1)];
    if (down >= right) {
      output.push({ kind: "remove", line: beforeLines[r] });
      r += 1;
    } else {
      output.push({ kind: "add", line: afterLines[c] });
      c += 1;
    }
  }

  while (r < rows) {
    output.push({ kind: "remove", line: beforeLines[r] });
    r += 1;
  }
  while (c < cols) {
    output.push({ kind: "add", line: afterLines[c] });
    c += 1;
  }

  return output;
}

function lineNumbersUntil(ops: LineDiffOp[], limit: number) {
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < limit; i += 1) {
    const op = ops[i];
    if (op.kind !== "add") oldLine += 1;
    if (op.kind !== "remove") newLine += 1;
  }
  return { oldLine, newLine };
}

function buildUnifiedDiff(before: string, after: string, beforeName: string, afterName: string): string {
  const beforeLines = before.replace(/\r\n/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const ops = computeLineDiff(beforeLines, afterLines);

  const changedIndexes: number[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].kind !== "equal") changedIndexes.push(i);
  }

  const out: string[] = [`--- ${beforeName}`, `+++ ${afterName}`];
  if (changedIndexes.length === 0) {
    out.push("@@ -1,0 +1,0 @@", " (no changes)");
    return `${out.join("\n")}\n`;
  }

  const context = 3;
  const hunks: Array<{ start: number; end: number }> = [];
  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - context);
    const end = Math.min(ops.length, changedIndex + context + 1);
    const prev = hunks[hunks.length - 1];
    if (!prev || start > prev.end) {
      hunks.push({ start, end });
    } else {
      prev.end = Math.max(prev.end, end);
    }
  }

  for (const hunk of hunks) {
    const begin = lineNumbersUntil(ops, hunk.start);
    let oldLine = begin.oldLine;
    let newLine = begin.newLine;
    let oldCount = 0;
    let newCount = 0;
    const hunkLines: string[] = [];

    for (let i = hunk.start; i < hunk.end; i += 1) {
      const op = ops[i];
      if (op.kind === "equal") {
        oldCount += 1;
        newCount += 1;
        oldLine += 1;
        newLine += 1;
        hunkLines.push(` ${op.line}`);
      } else if (op.kind === "remove") {
        oldCount += 1;
        oldLine += 1;
        hunkLines.push(`-${op.line}`);
      } else {
        newCount += 1;
        newLine += 1;
        hunkLines.push(`+${op.line}`);
      }
    }

    out.push(`@@ -${begin.oldLine},${oldCount} +${begin.newLine},${newCount} @@`);
    out.push(...hunkLines);
  }

  const MAX_LINES = 2000;
  if (out.length > MAX_LINES) {
    return `${out.slice(0, MAX_LINES).join("\n")}\n... (diff truncated)\n`;
  }

  return `${out.join("\n")}\n`;
}

async function generateNotebookPatchWithLlm(
  currentIpynbRaw: string,
  input: AdminNotebookLlmPatchInput
) {
  const selectedModel = routeModel(input.instruction, currentIpynbRaw.length);
  const selectedContext = input.selectedText ? `\nSelected excerpt:\n${input.selectedText}\n` : "";
  const prompt = [
    "You are a senior notebook maintainer.",
    "Apply the requested patch to the notebook JSON.",
    "Return JSON only, no markdown fences.",
    'Required schema: {"summary":"...","ipynb":{...}}',
    "Rules:",
    "- Keep notebook valid ipynb JSON.",
    "- Preserve metadata fields unless the instruction asks to change them.",
    "- Do not add meta commentary in notebook text.",
    "- Keep code executable and consistent.",
    "",
    "Instruction:",
    input.instruction,
    selectedContext,
    "Current notebook JSON:",
    currentIpynbRaw
  ].join("\n");

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (selectedModel.provider === "openai") {
    const result = await callOpenAI(prompt, selectedModel.modelId);
    text = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } else if (selectedModel.provider === "bedrock") {
    const result = await callBedrock(prompt, selectedModel.modelId);
    text = result.text;
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;
  } else {
    throw new Error("LLM provider is not configured for patch proposal.");
  }

  const parsed = parseAdminPatchModelOutput(text);
  if (!parsed) {
    throw new Error("LLM response parsing failed. Please refine the instruction and retry.");
  }

  const canonical = canonicalizeNotebookFile(parsed.notebook);
  const proposedIpynbRaw = `${JSON.stringify(canonical, null, 2)}\n`;
  const summary = parsed.summary || "LLM patch proposal generated.";

  return {
    summary,
    proposedIpynbRaw,
    provider: selectedModel.provider,
    modelId: selectedModel.modelId,
    tokensUsed: inputTokens + outputTokens
  };
}

function buildPrompt(questionText: string, contexts: Array<{ sectionId: string; content: string }>) {
  const contextBlock = contexts
    .map((context, index) => `[${index + 1}] section=${context.sectionId}\n${context.content}`)
    .join("\n\n");

  return [
    "You are an educational assistant for first-year undergraduate learners.",
    "Answer in Japanese with concise, accurate explanations.",
    "Use the provided context first, and then supplement with general knowledge only when needed.",
    "If context is insufficient, state uncertainty explicitly.",
    "Include a short bullet list named '次の一歩'.",
    "",
    "Context:",
    contextBlock,
    "",
    "Question:",
    questionText
  ].join("\n");
}

async function buildQuestionContext(notebookId: string, sectionId: string, questionText: string) {
  const notebook = await getNotebook(notebookId);
  if (!notebook) {
    throw new Error("Notebook not found.");
  }

  const chunks = Array.isArray(notebook.chunks) ? notebook.chunks : [];
  const ranked = rankChunks(chunks, sectionId, questionText);
  const contexts = ranked.map((item) => ({ sectionId: item.sectionId, content: item.content }));
  const sourceReferences: SourceReference[] = ranked.map((item) => ({
    notebookId,
    location: `#${item.sectionId}`
  }));

  return {
    notebook,
    contexts,
    sourceReferences,
    prompt: buildPrompt(questionText, contexts)
  };
}

function rankChunks(chunks: NotebookChunk[], sectionId: string, questionText: string): NotebookChunk[] {
  const tokens = tokenize(questionText);
  const ranked = chunks
    .map((chunk) => {
      const base = scoreChunk(tokens, chunk.content);
      const sectionBoost = chunk.sectionId === sectionId ? 2 : 0;
      return { chunk, score: base + sectionBoost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .filter((item) => item.score > 0)
    .map((item) => item.chunk);

  if (ranked.length > 0) {
    return ranked;
  }

  return chunks.slice(0, 3);
}

export async function askQuestion(input: AskQuestionInput, user: AuthUser): Promise<AskQuestionResult> {
  const notebook = await getNotebook(input.notebookId);
  if (!notebook) {
    throw new Error("Notebook not found.");
  }
  await assertQuestionRateLimitAvailable(user.userId);

  await putAccessLog(user.userId, input.notebookId, "ASK_QUESTION");

  const hash = questionHash(input.questionText);
  const cacheKey = toCacheKey(hash, input.notebookId, input.sectionId);
  const cacheResponse = await ddb.send(
    new GetCommand({
      TableName: CACHE_TABLE,
      Key: { cacheKey }
    })
  );

  const now = Math.floor(Date.now() / 1000);
  const cached = cacheResponse.Item as { answerSnapshot?: CachedAnswerSnapshot; expiresAt?: number } | undefined;

  const questionId = crypto.randomUUID();
  const createdAt = nowIso();

  if (cached?.answerSnapshot && typeof cached.expiresAt === "number" && cached.expiresAt > now) {
    const snapshot = cached.answerSnapshot;

    await ddb.send(
      new PutCommand({
        TableName: QUESTIONS_TABLE,
        Item: {
          questionId,
          userId: user.userId,
          userEmail: user.email,
          notebookId: input.notebookId,
          sectionId: input.sectionId,
          questionText: input.questionText,
          questionHash: hash,
          status: "COMPLETED",
          attempts: 0,
          createdAt,
          updatedAt: createdAt
        }
      })
    );

    await upsertAnswer({
      questionId,
      answerText: normalizeAssistantAnswerText(snapshot.answerText),
      sourceReferences: snapshot.sourceReferences,
      tokensPrompt: snapshot.tokensUsed,
      tokensCompletion: 0,
      modelId: snapshot.modelId,
      latencyMs: 0,
      createdAt,
      updatedAt: createdAt
    });

    await recordQuestionRateLimitUsage(user.userId);

    return {
      questionId,
      status: "COMPLETED",
      cached: true
    };
  }

  await ddb.send(
    new PutCommand({
      TableName: QUESTIONS_TABLE,
      Item: {
        questionId,
        userId: user.userId,
        userEmail: user.email,
        notebookId: input.notebookId,
        sectionId: input.sectionId,
        questionText: input.questionText,
        questionHash: hash,
        status: "QUEUED",
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      }
    })
  );

  if (!QA_QUEUE_URL) {
    throw new Error("QA_QUEUE_URL is not configured.");
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QA_QUEUE_URL,
      MessageBody: JSON.stringify({ questionId })
    })
  );

  await recordQuestionRateLimitUsage(user.userId);

  return {
    questionId,
    status: "QUEUED",
    cached: false
  };
}

export async function completeChat(input: ChatCompleteInput, user: AuthUser): Promise<ChatCompleteResult> {
  const provider = input.provider;
  const rateLimitScope = user.userId;
  await assertQuestionRateLimitAvailable(rateLimitScope);
  const { prompt, sourceReferences } = await buildQuestionContext(input.notebookId, input.sectionId, input.questionText);
  await putAccessLog(user.userId, input.notebookId, `CHAT_${provider.toUpperCase()}`);

  if (provider === "bedrock") {
    const adminUser = isAdmin(user);
    let remainingToday: number | null = null;
    if (!adminUser) {
      try {
        remainingToday = await acquireBedrockDailySlot(`bedrock:${user.userId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("ConditionalCheckFailed")) {
          throw new Error(`Bedrock daily limit exceeded (${BEDROCK_DAILY_LIMIT}/day).`);
        }
        throw error;
      }
    }
    const modelId = resolveBedrockModelId(
      input.modelId?.trim().toLowerCase() === "default" ? "" : input.modelId?.trim() || "",
      input.questionText,
      prompt
    );
    let result: ModelResponse;
    try {
      result = await callBedrock(prompt, modelId);
    } catch (error) {
      if (!adminUser) {
        await releaseBedrockDailySlot(`bedrock:${user.userId}`);
      }
      throw error;
    }
    await recordQuestionRateLimitUsage(rateLimitScope);
    const tokensUsed = result.inputTokens + result.outputTokens;
    const answerText = normalizeAssistantAnswerText(result.text || fallbackAnswer(input.questionText, []));
    const sessionId = await persistCompletedChat(input, user, answerText, sourceReferences, tokensUsed, modelId);
    return {
      answerText,
      sourceReferences,
      tokensUsed,
      sessionId,
      provider,
      modelId,
      bedrockRemainingToday: adminUser ? null : remainingToday
    };
  }

  if (provider === "openai") {
    const modelId = input.modelId?.trim() || process.env.OPENAI_MODEL_SMALL?.trim() || "gpt-5-nano";
    const apiKey = asString(input.apiKey).trim();
    if (!apiKey) {
      throw new Error("OpenAI API key is not configured.");
    }
    const result = await callOpenAIWithKey(prompt, modelId, apiKey);
    await recordQuestionRateLimitUsage(rateLimitScope);
    const tokensUsed = result.inputTokens + result.outputTokens;
    const answerText = normalizeAssistantAnswerText(result.text || fallbackAnswer(input.questionText, []));
    const sessionId = await persistCompletedChat(input, user, answerText, sourceReferences, tokensUsed, modelId);
    return {
      answerText,
      sourceReferences,
      tokensUsed,
      sessionId,
      provider,
      modelId,
      bedrockRemainingToday: null
    };
  }

  if (provider === "gemini") {
    const modelId = input.modelId?.trim() || "gemini-2.5-flash";
    const apiKey = asString(input.apiKey).trim();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }
    const result = await callGeminiWithKey(prompt, modelId, apiKey);
    await recordQuestionRateLimitUsage(rateLimitScope);
    const tokensUsed = result.inputTokens + result.outputTokens;
    const answerText = normalizeAssistantAnswerText(result.text || fallbackAnswer(input.questionText, []));
    const sessionId = await persistCompletedChat(input, user, answerText, sourceReferences, tokensUsed, modelId);
    return {
      answerText,
      sourceReferences,
      tokensUsed,
      sessionId,
      provider,
      modelId,
      bedrockRemainingToday: null
    };
  }

  throw new Error("Unsupported chat provider.");
}

export async function maybeInlineProcess(questionId: string): Promise<void> {
  if (!INLINE_QA) return;
  await processQuestionById(questionId).catch(() => undefined);
}

export async function getQuestionAnswer(questionId: string, user: AuthUser): Promise<GetAnswerResult> {
  const question = await getQuestion(questionId);
  if (!question) {
    return { kind: "not_found" };
  }

  if (!isAdmin(user) && question.userId !== user.userId) {
    return { kind: "forbidden" };
  }

  if (question.status === "FAILED") {
    return {
      kind: "failed",
      status: question.status,
      message: question.lastError || "回答生成に失敗しました。しばらくしてから再試行してください。"
    };
  }

  if (question.status !== "COMPLETED") {
    return {
      kind: "pending",
      status: question.status
    };
  }

  const answer = await getAnswer(questionId);
  if (!answer) {
    return {
      kind: "pending",
      status: "PROCESSING"
    };
  }

  return {
    kind: "completed",
    status: question.status,
    answer: {
      answerText: normalizeAssistantAnswerText(answer.answerText),
      sourceReferences: answer.sourceReferences,
      tokensUsed: answer.tokensPrompt + answer.tokensCompletion,
      timestamp: answer.createdAt
    }
  };
}

export async function processQuestionById(questionId: string): Promise<void> {
  const question = await getQuestion(questionId);
  if (!question) return;

  if (question.status !== "QUEUED" && question.status !== "FAILED") {
    return;
  }

  const startedAt = Date.now();

  await ddb.send(
    new UpdateCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, attempts = if_not_exists(attempts, :zero) + :inc, lastError = :empty",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "PROCESSING",
        ":updatedAt": nowIso(),
        ":inc": 1,
        ":zero": 0,
        ":empty": ""
      }
    })
  );

  try {
    const notebook = await getNotebook(question.notebookId);
    if (!notebook) {
      throw new Error("Notebook not found.");
    }

    const chunks = Array.isArray(notebook.chunks) ? notebook.chunks : [];
    const ranked = rankChunks(chunks, question.sectionId, question.questionText);

    const contexts = ranked.map((item) => ({ sectionId: item.sectionId, content: item.content }));
    const sourceReferences: SourceReference[] = ranked.map((item) => ({
      notebookId: question.notebookId,
      location: `#${item.sectionId}`
    }));

    const prompt = buildPrompt(question.questionText, contexts);
    const selectedModel = routeModel(
      question.questionText,
      contexts.reduce((acc, item) => acc + item.content.length, 0)
    );
    const modelId = selectedModel.provider === "mock" ? "mock" : `${selectedModel.provider}:${selectedModel.modelId}`;

    let answerText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    if (selectedModel.provider === "openai") {
      const result = await callOpenAI(prompt, selectedModel.modelId);
      answerText = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else if (selectedModel.provider === "bedrock") {
      const result = await callBedrock(prompt, selectedModel.modelId);
      answerText = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    }

    if (!answerText) {
      answerText = fallbackAnswer(
        question.questionText,
        contexts.map((item) => item.content)
      );
    }
    answerText = normalizeAssistantAnswerText(answerText);

    const completedAt = nowIso();
    await upsertAnswer({
      questionId,
      answerText,
      sourceReferences,
      tokensPrompt: inputTokens,
      tokensCompletion: outputTokens,
      modelId,
      latencyMs: Date.now() - startedAt,
      createdAt: completedAt,
      updatedAt: completedAt
    });

    await ddb.send(
      new UpdateCommand({
        TableName: QUESTIONS_TABLE,
        Key: { questionId },
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt REMOVE lastError",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":updatedAt": completedAt
        }
      })
    );

    const cacheKey = toCacheKey(question.questionHash, question.notebookId, question.sectionId);
    await putCachedAnswer(cacheKey, toSnapshot(answerText, sourceReferences, inputTokens, outputTokens, modelId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ddb.send(
      new UpdateCommand({
        TableName: QUESTIONS_TABLE,
        Key: { questionId },
        UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, lastError = :lastError",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": "FAILED",
          ":updatedAt": nowIso(),
          ":lastError": message
        }
      })
    );
    throw error;
  }
}

async function batchGetAnswers(questionIds: string[]): Promise<Map<string, AnswerItem>> {
  if (questionIds.length === 0) {
    return new Map();
  }

  const response = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [ANSWERS_TABLE]: {
          Keys: questionIds.map((questionId) => ({ questionId }))
        }
      }
    })
  );

  const map = new Map<string, AnswerItem>();
  for (const item of (response.Responses?.[ANSWERS_TABLE] as AnswerItem[] | undefined) ?? []) {
    map.set(item.questionId, item);
  }

  return map;
}

function normalizeHistorySessionId(question: QuestionItem) {
  return String(question.sessionId || question.questionId || "").trim();
}

function summarizeHistorySessionTitle(questionText: string) {
  const compact = String(questionText || "")
    .split(/\n{2,}/)[0]
    .replace(/\[Selection[\s\S]*$/i, "")
    .replace(/\[SelectionType[\s\S]*$/i, "")
    .trim();
  if (!compact) return "Untitled session";
  return compact.length > 72 ? `${compact.slice(0, 72)}…` : compact;
}

export async function listQuestionHistory(user: AuthUser, notebookId: string, sessionId?: string) {
  if (!notebookId.trim()) {
    throw new Error("notebookId is required");
  }

  let questions: QuestionItem[] = [];
  if (isAdmin(user)) {
    const response = await ddb.send(
      new ScanCommand({
        TableName: QUESTIONS_TABLE,
        FilterExpression: "notebookId = :notebookId AND #status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":notebookId": notebookId,
          ":status": "COMPLETED"
        },
        Limit: 200
      })
    );

    questions = ((response.Items as QuestionItem[] | undefined) ?? [])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
  } else {
    const response = await ddb.send(
      new QueryCommand({
        TableName: QUESTIONS_TABLE,
        IndexName: "user-createdAt-index",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": user.userId
        },
        ScanIndexForward: false,
        Limit: 100
      })
    );

    questions = ((response.Items as QuestionItem[] | undefined) ?? [])
      .filter((item) => item.notebookId === notebookId && item.status === "COMPLETED")
      .slice(0, 10);
  }

  const answers = await batchGetAnswers(questions.map((item) => item.questionId));
  const completedItems = questions
    .map((question) => {
      const answer = answers.get(question.questionId);
      if (!answer) return null;
      return {
        questionId: question.questionId,
        sessionId: normalizeHistorySessionId(question),
        sectionId: question.sectionId,
        questionText: question.questionText,
        answerText: normalizeAssistantAnswerText(answer.answerText),
        sourceReferences: answer.sourceReferences,
        createdAt: question.createdAt
      };
    })
    .filter(Boolean) as Array<{
      questionId: string;
      sessionId: string;
      sectionId: string;
      questionText: string;
      answerText: string;
      sourceReferences: SourceReference[];
      createdAt: string;
    }>;

  const requestedSessionId = String(sessionId || "").trim();
  if (requestedSessionId) {
    return {
      sessionId: requestedSessionId,
      items: completedItems
        .filter((item) => item.sessionId === requestedSessionId)
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
    };
  }

  const sessions = new Map<string, typeof completedItems>();
  completedItems.forEach((item) => {
    const current = sessions.get(item.sessionId) || [];
    current.push(item);
    sessions.set(item.sessionId, current);
  });

  return {
    sessions: Array.from(sessions.entries())
      .map(([resolvedSessionId, items]) => {
        const sorted = items.slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        return {
          sessionId: resolvedSessionId,
          title: summarizeHistorySessionTitle(first?.questionText || ""),
          preview: summarizeHistorySessionTitle(last?.questionText || ""),
          createdAt: first?.createdAt || "",
          lastMessageAt: last?.createdAt || "",
          messageCount: sorted.length * 2
        };
      })
      .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")))
  };
}

export function parseLearningProgressPutInput(event: APIGatewayProxyEventV2): LearningProgressNotebookRecord | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const visits = Number(payload.visits);
  const lastVisitedAt = asString(payload.lastVisitedAt).trim();
  const completed = Boolean(payload.completed);
  const completedAt = asString(payload.completedAt).trim();
  const checkBestScore = Number(payload.checkBestScore || 0);
  const checkAttempts = Number(payload.checkAttempts || 0);

  if (!Number.isFinite(visits) || visits < 0) return null;
  if (!lastVisitedAt || Number.isNaN(Date.parse(lastVisitedAt))) return null;
  if (completed && (!completedAt || Number.isNaN(Date.parse(completedAt)))) return null;
  if (!completed && completedAt) return null;
  if (!Number.isFinite(checkBestScore) || checkBestScore < 0) return null;
  if (!Number.isFinite(checkAttempts) || checkAttempts < 0) return null;

  return {
    visits: Math.floor(visits),
    lastVisitedAt: new Date(Date.parse(lastVisitedAt)).toISOString(),
    completed,
    completedAt: completed ? new Date(Date.parse(completedAt)).toISOString() : "",
    checkPassed: Boolean(payload.checkPassed || completed),
    checkPassedAt:
      payload.checkPassed || completed
        ? new Date(Date.parse(asString(payload.checkPassedAt || completedAt || lastVisitedAt))).toISOString()
        : "",
    checkBestScore: Math.floor(checkBestScore),
    checkAttempts: Math.floor(checkAttempts)
  };
}

export function parseChapterLearningProgressPutInput(event: APIGatewayProxyEventV2): LearningProgressChapterRecord | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const finalPassed = Boolean(payload.finalPassed);
  const finalPassedAt = asString(payload.finalPassedAt).trim();
  const finalBestScore = Number(payload.finalBestScore);
  const finalMaxScore = Number(payload.finalMaxScore);
  const finalAttempts = Number(payload.finalAttempts);

  if (finalPassed && (!finalPassedAt || Number.isNaN(Date.parse(finalPassedAt)))) return null;
  if (!Number.isFinite(finalBestScore) || finalBestScore < 0) return null;
  if (!Number.isFinite(finalMaxScore) || finalMaxScore < 0) return null;
  if (!Number.isFinite(finalAttempts) || finalAttempts < 0) return null;

  return {
    finalPassed,
    finalPassedAt: finalPassed ? new Date(Date.parse(finalPassedAt)).toISOString() : "",
    finalBestScore: Math.floor(finalBestScore),
    finalMaxScore: Math.floor(finalMaxScore),
    finalAttempts: Math.floor(finalAttempts)
  };
}

export async function listAdminQuestions() {
  const response = await ddb.send(
    new ScanCommand({
      TableName: QUESTIONS_TABLE,
      Limit: 300
    })
  );

  const questions = ((response.Items as QuestionItem[] | undefined) ?? [])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);

  const answers = await batchGetAnswers(questions.map((item) => item.questionId));

  return {
    items: questions.map((question) => ({
      id: question.questionId,
      user: {
        email: (question as QuestionItem & { userEmail?: string }).userEmail || null,
        name: null
      },
      notebookId: question.notebookId,
      sectionId: question.sectionId,
      questionText: question.questionText,
      status: question.status,
      createdAt: question.createdAt,
      answerText: answers.get(question.questionId)?.answerText || null
    }))
  };
}

export async function listCatalog() {
  const items: unknown[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await ddb.send(
      new ScanCommand({
        TableName: NOTEBOOKS_TABLE,
        Limit: 1000,
        ExclusiveStartKey: exclusiveStartKey
      })
    );
    items.push(...((response.Items as unknown[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  const rows = items.map((item) => normalizeNotebookRecord(item)).filter((item): item is NotebookRecord => Boolean(item)).slice();
  const chapters = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      audience: "beginner" | "advanced";
      notebooks: Array<{
        id: string;
        title: string;
        order: number;
        tags: string[];
        htmlPath: string;
        colabUrl: string;
        videoUrl?: string;
        source?: NotebookRecord["source"];
      }>;
    }
  >();

  rows.sort((a, b) => {
    const orderA = Number.isFinite(a.chapterOrder) ? Number(a.chapterOrder) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.chapterOrder) ? Number(b.chapterOrder) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const chapterCmp = a.chapter.localeCompare(b.chapter);
    if (chapterCmp !== 0) return chapterCmp;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });

  for (const row of rows) {
    const chapterId = resolveCanonicalChapterId(row.chapterId || "", row.chapter);
    const chapter = chapters.get(chapterId) ?? {
      id: chapterId,
      title: row.chapter,
      order: Number.isFinite(row.chapterOrder) ? Number(row.chapterOrder) : chapters.size + 1,
      audience: row.audience || inferChapterAudience(chapterId, row.chapter),
      notebooks: []
    };

    chapter.notebooks.push({
      id: row.notebookId,
      title: row.title,
      order: row.sortOrder,
      tags: Array.isArray(row.tags) ? row.tags : [],
      htmlPath: row.htmlPath,
      colabUrl: row.colabUrl,
      videoUrl: row.videoUrl || undefined,
      source: row.source
    });
    chapters.set(chapterId, chapter);
  }

  return {
    source: {
      type: "github",
      repo: CONTENT_GITHUB_REPO,
      ref: CONTENT_GITHUB_REF,
      commitSha: (process.env.SOURCE_COMMIT_SHA || "").trim() || null
    },
    chapters: Array.from(chapters.values())
      .sort((a, b) => a.order - b.order)
      .map((chapter) => ({
        ...chapter,
        notebooks: chapter.notebooks.sort((a, b) => a.order - b.order)
      }))
  };
}

const ASSESSMENT_CHAPTER_IDS = new Set([
  "python",
  "machine-learning",
  "deep-learning",
  "reinforcement-learning",
  "llm",
  "deep-generative-models",
  "world-models"
]);

const ASSESSMENT_ROOT = path.join(process.cwd(), "content", "assessments");
const NOTEBOOK_CHECK_DIR = path.join(ASSESSMENT_ROOT, "notebook-checks");
const CHAPTER_FINAL_DIR = path.join(ASSESSMENT_ROOT, "chapter-finals");
type AssessmentStorageKind = "notebook-checks" | "chapter-finals";

type NotebookAssessmentChoice = {
  id: string;
  text: string;
};

type NotebookAssessmentQuestion = {
  id: string;
  prompt: string;
  choices: NotebookAssessmentChoice[];
  correctChoiceId: string;
  explanation: string;
  learningObjective?: string;
};

type NotebookAssessment = {
  schemaVersion: 1;
  notebookId: string;
  title: string;
  passScore: 5;
  questions: NotebookAssessmentQuestion[];
};

type ChapterFinalAssessmentRubricPoint = {
  id: string;
  description: string;
  points: number;
  keywords?: string[];
};

type ChapterFinalAssessmentQuestion = {
  id: string;
  type: "multiple_choice" | "short_text" | "coding" | "concept";
  prompt: string;
  choices?: NotebookAssessmentChoice[];
  correctChoiceId?: string;
  rubricPoints?: ChapterFinalAssessmentRubricPoint[];
  maxPoints: number;
  explanation?: string;
};

type ChapterFinalAssessment = {
  schemaVersion: 1;
  chapterId: string;
  title: string;
  passRatio: 0.9;
  questions: ChapterFinalAssessmentQuestion[];
};

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function validateNotebookCheckAssessment(raw: unknown, notebook: { id: string; title: string }): NotebookAssessment | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const questions = Array.isArray(value.questions) ? value.questions : [];
  if (questions.length !== 5) return null;

  const normalizedQuestions = questions.map<NotebookAssessmentQuestion | null>((question, index) => {
    const item = question && typeof question === "object" ? (question as Record<string, unknown>) : {};
    const choices = Array.isArray(item.choices) ? item.choices : [];
    const normalizedChoices = choices
      .map((choice) => {
        const candidate = choice && typeof choice === "object" ? (choice as Record<string, unknown>) : {};
        return {
          id: asString(candidate.id).trim(),
          text: asString(candidate.text).trim()
        };
      })
      .filter((choice) => choice.id && choice.text);
    const correctChoiceId = asString(item.correctChoiceId).trim();
    if (!asString(item.prompt).trim() || normalizedChoices.length < 2 || !normalizedChoices.some((choice) => choice.id === correctChoiceId)) {
      return null;
    }
    return {
      id: asString(item.id).trim() || `q${index + 1}`,
      prompt: asString(item.prompt),
      choices: normalizedChoices,
      correctChoiceId,
      explanation: asString(item.explanation),
      learningObjective: asString(item.learningObjective).trim() || undefined
    };
  });

  if (normalizedQuestions.some((question) => !question)) return null;
  return {
    schemaVersion: 1,
    notebookId: notebook.id,
    title: asString(value.title).trim() || `${notebook.title} 確認問題`,
    passScore: 5,
    questions: normalizedQuestions.filter(isNonNull)
  };
}

function validateChapterFinalAssessment(raw: unknown, chapter: { id: string; title: string }): ChapterFinalAssessment | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const questions = Array.isArray(value.questions) ? value.questions : [];
  if (questions.length < 1) return null;

  const normalizedQuestions = questions.slice(0, 12).map<ChapterFinalAssessmentQuestion | null>((question, index) => {
    const item = question && typeof question === "object" ? (question as Record<string, unknown>) : {};
    const type = asString(item.type).trim() || "short_text";
    if (!["multiple_choice", "short_text", "coding", "concept"].includes(type)) return null;
    const maxPoints = Math.max(1, Number(item.maxPoints || 10));
    const rubricPoints = Array.isArray(item.rubricPoints)
      ? item.rubricPoints
          .map<ChapterFinalAssessmentRubricPoint | null>((point) => {
            const rubric = point && typeof point === "object" ? (point as Record<string, unknown>) : {};
            const id = asString(rubric.id).trim();
            const description = asString(rubric.description).trim();
            if (!id || !description) return null;
            return {
              id,
              description,
              points: Math.max(0, Math.round(Number(rubric.points || 0))),
              keywords: Array.isArray(rubric.keywords) ? rubric.keywords.map((keyword) => asString(keyword)).filter(Boolean) : undefined
            };
          })
          .filter(isNonNull)
      : undefined;
    const choices = Array.isArray(item.choices)
      ? item.choices
          .map((choice) => {
            const candidate = choice && typeof choice === "object" ? (choice as Record<string, unknown>) : {};
            return {
              id: asString(candidate.id).trim(),
              text: asString(candidate.text).trim()
            };
          })
          .filter((choice) => choice.id && choice.text)
      : undefined;
    const prompt = asString(item.prompt);
    if (!prompt.trim()) return null;
    return {
      id: asString(item.id).trim() || `q${index + 1}`,
      type: type as ChapterFinalAssessmentQuestion["type"],
      prompt,
      choices,
      correctChoiceId: asString(item.correctChoiceId).trim() || undefined,
      rubricPoints,
      maxPoints,
      explanation: asString(item.explanation).trim() || undefined
    };
  });

  if (normalizedQuestions.some((question) => !question)) return null;
  return {
    schemaVersion: 1,
    chapterId: chapter.id,
    title: asString(value.title).trim() || `${chapter.title} 最終問題`,
    passRatio: 0.9,
    questions: normalizedQuestions.filter(isNonNull)
  };
}

async function findAssessmentNotebook(notebookId: string) {
  const catalog = await listCatalog();
  for (const chapter of catalog.chapters) {
    const notebook = chapter.notebooks.find((item) => item.id === notebookId);
    if (notebook && ASSESSMENT_CHAPTER_IDS.has(chapter.id)) return { chapter, notebook };
  }
  return null;
}

async function loadAssessmentJson(kind: AssessmentStorageKind, id: string): Promise<unknown | null> {
  if (NOTEBOOK_BUCKET) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: NOTEBOOK_BUCKET,
          Key: `assessments/${kind}/${id}.json`
        })
      );
      return JSON.parse(await streamBodyToString(response.Body)) as unknown;
    } catch {
      return null;
    }
  }

  const localDir = kind === "notebook-checks" ? NOTEBOOK_CHECK_DIR : CHAPTER_FINAL_DIR;
  try {
    return JSON.parse(await fs.readFile(path.join(localDir, `${id}.json`), "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function getNotebookAssessment(notebookId: string) {
  const found = await findAssessmentNotebook(notebookId);
  if (!found) return null;
  const raw = await loadAssessmentJson("notebook-checks", notebookId);
  if (!raw) return null;
  const assessment = validateNotebookCheckAssessment(raw, found.notebook);
  if (!assessment) return null;
  return {
    ...assessment,
    questions: assessment.questions.map(({ correctChoiceId: _correctChoiceId, ...question }) => question)
  };
}

export async function submitNotebookAssessmentAttempt(notebookId: string, answers: Record<string, unknown>) {
  const found = await findAssessmentNotebook(notebookId);
  if (!found) return null;
  const raw = await loadAssessmentJson("notebook-checks", notebookId);
  if (!raw) return null;
  const assessment = validateNotebookCheckAssessment(raw, found.notebook);
  if (!assessment) return null;
  const results = assessment.questions.map((question) => {
    const selectedChoiceId = asString(answers[question.id]).trim();
    return {
      questionId: question.id,
      selectedChoiceId,
      correct: selectedChoiceId === question.correctChoiceId,
      explanation: question.explanation,
      correctChoiceId: question.correctChoiceId
    };
  });
  const score = results.reduce((sum, result) => sum + (result.correct ? 1 : 0), 0);
  return { notebookId, score, total: assessment.questions.length, passed: score >= assessment.passScore, results };
}

export async function getChapterFinalAssessment(chapterId: string) {
  const catalog = await listCatalog();
  const chapter = catalog.chapters.find((item) => item.id === chapterId);
  if (!chapter || !ASSESSMENT_CHAPTER_IDS.has(chapter.id)) return null;
  const raw = await loadAssessmentJson("chapter-finals", chapterId);
  if (!raw) return null;
  return validateChapterFinalAssessment(raw, chapter);
}

function gradeChapterFinalAssessmentLocally(assessment: Awaited<ReturnType<typeof getChapterFinalAssessment>>, chapterId: string, answers: Record<string, unknown>) {
  if (!assessment) return null;
  const results = assessment.questions.map((question) => {
    const answer = asString(answers[question.id]).toLowerCase();
    let score = 0;
    const feedback: string[] = [];
    const rubricPoints = Array.isArray(question.rubricPoints) ? question.rubricPoints : [];
    for (const point of rubricPoints) {
      const keywords = Array.isArray(point.keywords) ? point.keywords : [];
      const matched = keywords.some((keyword) => answer.includes(String(keyword).toLowerCase()));
      if (matched && answer.trim().length >= 20) {
        score += point.points;
        feedback.push(`OK: ${point.description}`);
      } else {
        feedback.push(`要改善: ${point.description}`);
      }
    }
    return { questionId: question.id, score, maxPoints: question.maxPoints, feedback: feedback.join(" / ") };
  });
  const score = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;
  return { chapterId, score, maxScore, ratio, passed: ratio >= assessment.passRatio, gradingProvider: "local", results };
}

function buildChapterFinalLlmGradingPrompt(assessment: NonNullable<Awaited<ReturnType<typeof getChapterFinalAssessment>>>, answers: Record<string, unknown>): string {
  const questions = assessment.questions.map((question) => ({
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    maxPoints: question.maxPoints,
    rubricPoints: question.rubricPoints,
    answer: asString(answers[question.id])
  }));
  return [
    "You are grading Japanese learning assessment answers for Noema.",
    "Grade strictly against the rubric points. Award points only when the answer clearly satisfies the point.",
    "For coding answers, judge whether the submitted code or explanation would satisfy the requested behavior; do not execute code.",
    "Return JSON only. No markdown fences.",
    'Required schema: {"results":[{"questionId":"q1","score":0,"maxPoints":10,"feedback":"短い日本語フィードバック"}]}',
    "Rules:",
    "- score must be an integer from 0 to maxPoints.",
    "- feedback must mention missing rubric points when any points are lost.",
    "- Do not add questions not present in the input.",
    "",
    JSON.stringify({ chapterId: assessment.chapterId, passRatio: assessment.passRatio, questions }, null, 2)
  ].join("\n");
}

function parseLlmJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

export async function submitChapterFinalAssessmentAttempt(
  chapterId: string,
  answers: Record<string, unknown>,
  target?: { provider?: string; modelId?: string; apiKey?: string }
) {
  const assessment = await getChapterFinalAssessment(chapterId);
  if (!assessment) return null;
  const validationError = validateChapterFinalAnswerMap(answers);
  if (validationError) {
    throw new Error(validationError);
  }
  const sanitizedAnswers = sanitizeChapterFinalAnswerMap(answers);

  const provider = asString(target?.provider).trim().toLowerCase();
  const apiKey = asString(target?.apiKey).trim();
  if ((provider !== "openai" && provider !== "gemini") || !apiKey) {
    return gradeChapterFinalAssessmentLocally(assessment, chapterId, sanitizedAnswers);
  }

  const modelId = asString(target?.modelId).trim() || (provider === "openai" ? "gpt-5-nano" : "gemini-2.5-flash");
  const prompt = buildChapterFinalLlmGradingPrompt(assessment, sanitizedAnswers);
  let text = "";
  try {
    const response = provider === "openai"
      ? await callOpenAIWithKey(prompt, modelId, apiKey)
      : await callGeminiWithKey(prompt, modelId, apiKey);
    text = response.text;
  } catch {
    return gradeChapterFinalAssessmentLocally(assessment, chapterId, sanitizedAnswers);
  }
  const parsed = parseLlmJsonObject(text);
  if (!parsed) {
    return gradeChapterFinalAssessmentLocally(assessment, chapterId, sanitizedAnswers);
  }
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
  const results = assessment.questions.map((question) => {
    const item = rawResults.find((candidate) => {
      return candidate && typeof candidate === "object" && asString((candidate as Record<string, unknown>).questionId) === question.id;
    }) as Record<string, unknown> | undefined;
    const rawScore = Number(item?.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(question.maxPoints, Math.round(rawScore))) : 0;
    const feedback = asString(item?.feedback).trim() || "LLMルーブリック採点を行いました。";
    return { questionId: question.id, score, maxPoints: question.maxPoints, feedback };
  });
  const score = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;
  return { chapterId, score, maxScore, ratio, passed: ratio >= assessment.passRatio, gradingProvider: provider, modelId, results };
}

function buildGradingAgentPrompt(input: {
  chapterId: string;
  questionId: string;
  prompt: string;
  maxPoints: number;
  rubricPoints: Array<{ id: string; description: string; points: number; keywords?: string[] }>;
  answer: string;
}) {
  return [
    "You are Noema's independent grading agent.",
    "Grade exactly one assessment answer using only the expected rubric points and the learner answer.",
    "Return JSON only. No markdown fences.",
    'Required schema: {"score":0,"maxPoints":10,"feedback":"日本語で短く具体的に","pointResults":[{"id":"...","met":true,"pointsAwarded":0,"comment":"..."}]}',
    "Rules:",
    "- Award points only for rubric points clearly satisfied by the answer.",
    "- Do not infer unstated knowledge.",
    "- For coding answers, inspect the code logically but do not execute it.",
    "- score must be an integer between 0 and maxPoints.",
    "- feedback must mention the missing points when score is not full.",
    "",
    JSON.stringify(input, null, 2)
  ].join("\n");
}

function normalizeGradingAgentResult(rawText: string, maxPoints: number) {
  const parsed = parseLlmJsonObject(rawText);
  if (!parsed) {
    throw new Error("Grading agent returned invalid JSON.");
  }
  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(maxPoints, Math.round(rawScore))) : 0;
  const feedback = asString(parsed.feedback).trim() || "採点官エージェントが採点しました。";
  const pointResults = Array.isArray(parsed.pointResults) ? parsed.pointResults : [];
  return { score, feedback, pointResults };
}

export async function createChapterFinalAssessmentAttempt(user: AuthUser, chapterId: string, answers: Record<string, unknown>) {
  const assessment = await getChapterFinalAssessment(chapterId);
  if (!assessment) return null;
  if (!QA_QUEUE_URL) throw new Error("QA_QUEUE_URL is not configured.");
  const validationError = validateChapterFinalAnswerMap(answers);
  if (validationError) throw new Error(validationError);
  const sanitizedAnswers = sanitizeChapterFinalAnswerMap(answers);

  const attemptId = crypto.randomUUID();
  const createdAt = nowIso();
  const modelId = resolveBedrockModelId("", "grade final assessment", JSON.stringify(assessment).slice(0, 3000));
  const tasks = assessment.questions.map((question) => ({
    questionId: question.id,
    type: question.type,
    prompt: question.prompt,
    maxPoints: question.maxPoints,
    rubricPoints: question.rubricPoints,
    answer: asString(sanitizedAnswers[question.id]),
    status: "QUEUED",
    score: 0,
    feedback: "",
    pointResults: []
  }));

  await ddb.send(
    new PutCommand({
      TableName: QUESTIONS_TABLE,
      Item: {
        questionId: `ASSESSMENT_ATTEMPT#${attemptId}`,
        attemptId,
        itemType: "CHAPTER_FINAL_ATTEMPT",
        userId: user.userId,
        userEmail: user.email,
        notebookId: `chapter:${chapterId}`,
        chapterId,
        sectionId: "final",
        questionText: `${assessment.title} grading attempt`,
        questionHash: questionHash(`${chapterId}:${attemptId}`),
        status: "QUEUED",
        assessmentTitle: assessment.title,
        passRatio: assessment.passRatio,
        gradingProvider: "bedrock",
        modelId,
        tasks,
        score: 0,
        maxScore: tasks.reduce((sum, task) => sum + Number(task.maxPoints || 0), 0),
        ratio: 0,
        passed: false,
        createdAt,
        updatedAt: createdAt
      }
    })
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: QA_QUEUE_URL,
      MessageBody: JSON.stringify({ gradingAttemptId: attemptId })
    })
  );

  return {
    attemptId,
    chapterId,
    status: "QUEUED",
    gradingProvider: "bedrock",
    modelId,
    score: 0,
    maxScore: tasks.reduce((sum, task) => sum + Number(task.maxPoints || 0), 0),
    ratio: 0,
    passed: false,
    results: tasks.map((task) => ({
      questionId: task.questionId,
      score: 0,
      maxPoints: task.maxPoints,
      feedback: "採点待ちです。"
    }))
  };
}

export async function getChapterFinalAssessmentAttempt(user: AuthUser, attemptId: string) {
  const response = await ddb.send(
    new GetCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId: `ASSESSMENT_ATTEMPT#${attemptId}` }
    })
  );
  const item = response.Item as Record<string, unknown> | undefined;
  if (!item) return { kind: "not_found" as const };
  if (!isAdmin(user) && item.userId !== user.userId) return { kind: "forbidden" as const };
  const tasks = Array.isArray(item.tasks) ? item.tasks as Array<Record<string, unknown>> : [];
  return {
    kind: "ok" as const,
    attempt: {
      attemptId: asString(item.attemptId),
      chapterId: asString(item.chapterId),
      status: asString(item.status),
      gradingProvider: asString(item.gradingProvider) || "bedrock",
      modelId: asString(item.modelId),
      score: Number(item.score || 0),
      maxScore: Number(item.maxScore || 0),
      ratio: Number(item.ratio || 0),
      passed: Boolean(item.passed),
      results: tasks.map((task) => ({
        questionId: asString(task.questionId),
        score: Number(task.score || 0),
        maxPoints: Number(task.maxPoints || 0),
        feedback: asString(task.feedback) || "採点待ちです。",
        status: asString(task.status)
      }))
    }
  };
}

export async function processChapterFinalAssessmentAttemptById(attemptId: string) {
  const key = { questionId: `ASSESSMENT_ATTEMPT#${attemptId}` };
  const response = await ddb.send(new GetCommand({ TableName: QUESTIONS_TABLE, Key: key }));
  const item = response.Item as Record<string, unknown> | undefined;
  if (!item) throw new Error(`Assessment attempt not found: ${attemptId}`);
  const tasks = Array.isArray(item.tasks) ? item.tasks as Array<Record<string, unknown>> : [];
  const modelId = asString(item.modelId) || resolveBedrockModelId("", "grade final assessment", JSON.stringify(tasks).slice(0, 3000));
  const startedAt = nowIso();

  await ddb.send(
    new UpdateCommand({
      TableName: QUESTIONS_TABLE,
      Key: key,
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "PROCESSING", ":updatedAt": startedAt }
    })
  );

  const gradedTasks: Array<Record<string, unknown>> = [];
  try {
    for (const task of tasks) {
      const maxPoints = Number(task.maxPoints || 0);
      const prompt = buildGradingAgentPrompt({
        chapterId: asString(item.chapterId),
        questionId: asString(task.questionId),
        prompt: asString(task.prompt),
        maxPoints,
        rubricPoints: Array.isArray(task.rubricPoints) ? task.rubricPoints as Array<{ id: string; description: string; points: number; keywords?: string[] }> : [],
        answer: asString(task.answer)
      });
      const result = await callBedrock(prompt, modelId);
      const normalized = normalizeGradingAgentResult(result.text, maxPoints);
      gradedTasks.push({
        ...task,
        status: "COMPLETED",
        score: normalized.score,
        feedback: normalized.feedback,
        pointResults: normalized.pointResults,
        gradedAt: nowIso(),
        gradingProvider: "bedrock",
        modelId
      });
    }

    const score = gradedTasks.reduce((sum, task) => sum + Number(task.score || 0), 0);
    const maxScore = gradedTasks.reduce((sum, task) => sum + Number(task.maxPoints || 0), 0);
    const ratio = maxScore > 0 ? score / maxScore : 0;
    const passed = ratio >= Number(item.passRatio || 0.9);
    const completedAt = nowIso();

    await ddb.send(
      new UpdateCommand({
        TableName: QUESTIONS_TABLE,
        Key: key,
        UpdateExpression: "SET #status = :status, tasks = :tasks, score = :score, maxScore = :maxScore, ratio = :ratio, passed = :passed, updatedAt = :updatedAt, completedAt = :completedAt REMOVE lastError",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "COMPLETED",
          ":tasks": gradedTasks,
          ":score": score,
          ":maxScore": maxScore,
          ":ratio": ratio,
          ":passed": passed,
          ":updatedAt": completedAt,
          ":completedAt": completedAt
        }
      })
    );
  } catch (error) {
    const failedAt = nowIso();
    await ddb.send(
      new UpdateCommand({
        TableName: QUESTIONS_TABLE,
        Key: key,
        UpdateExpression: "SET #status = :status, tasks = :tasks, updatedAt = :updatedAt, lastError = :lastError",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "FAILED",
          ":tasks": gradedTasks.length ? gradedTasks.concat(tasks.slice(gradedTasks.length)) : tasks,
          ":updatedAt": failedAt,
          ":lastError": error instanceof Error ? error.message : String(error)
        }
      })
    );
    throw error;
  }
}

function inferChapterAudience(chapterId: string, chapterTitle: string): "beginner" | "advanced" {
  const normalizedId = String(chapterId || "").trim().toLowerCase();
  const normalizedTitle = String(chapterTitle || "").trim().toLowerCase();
  if (
    normalizedId === "python" ||
    normalizedId === "machine-learning" ||
    normalizedTitle === "python" ||
    normalizedTitle === "機械学習"
  ) {
    return "beginner";
  }
  return "advanced";
}

const KNOWN_CHAPTER_ID_BY_TITLE: Record<string, string> = {
  Python: "python",
  機械学習: "machine-learning",
  ディープラーニング: "deep-learning",
  強化学習: "reinforcement-learning",
  LLM: "llm",
  深層生成モデル: "deep-generative-models",
  世界モデル: "world-models",
  "Neuromatch Academy / Computational Neuroscience": "nma-compneuro",
  "Neuromatch Academy / Deep Learning": "nma-deep-learning"
};

function resolveCanonicalChapterId(rawChapterId: string, chapterTitle: string): string {
  const explicit = String(rawChapterId || "").trim();
  if (explicit) return explicit;

  const known = KNOWN_CHAPTER_ID_BY_TITLE[String(chapterTitle || "").trim()];
  if (known) return known;

  return slugify(chapterTitle) || "chapter";
}

function normalizeNotebookTags(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    return raw
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 32);
  }

  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function asFiniteNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function buildDefaultColabUrl(notebookId: string): string {
  const safeNotebookId = notebookId.trim();
  if (!safeNotebookId) {
    return "https://colab.research.google.com/";
  }
  return `https://colab.research.google.com/github/${COLAB_GITHUB_REPO}/blob/${COLAB_GITHUB_REF}/content/notebooks/${encodeURIComponent(safeNotebookId)}.ipynb`;
}

function buildSourceNotebookRawUrl(notebookId: string): string {
  return `https://raw.githubusercontent.com/${CONTENT_GITHUB_REPO}/${CONTENT_GITHUB_REF}/content/notebooks/${encodeURIComponent(
    notebookId
  )}.ipynb`;
}

function normalizeColabUrl(raw: string, notebookId: string): string {
  const value = raw.trim();
  if (!value || value === "https://colab.research.google.com" || value === "https://colab.research.google.com/") {
    return buildDefaultColabUrl(notebookId);
  }

  if (value.includes("/public/notebooks/")) {
    return value.replace("/public/notebooks/", "/content/notebooks/");
  }

  return value;
}

function normalizeNotebookRecord(raw: unknown): NotebookRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const notebookId = asString(record.notebookId || record.id).trim();
  if (!notebookId) return null;

  const title = asString(record.title).trim() || notebookId;
  const chapter = asString(record.chapter).trim() || "未分類";
  const chapterId = resolveCanonicalChapterId(asString(record.chapterId).trim(), chapter);
  const chapterOrderValue = asFiniteNumber(record.chapterOrder, Number.NaN);
  const chapterOrder = Number.isFinite(chapterOrderValue) ? Math.max(1, Math.floor(chapterOrderValue)) : undefined;
  const rawAudience = asString(record.audience).trim().toLowerCase();
  const audience = rawAudience === "beginner" || rawAudience === "advanced" ? rawAudience : undefined;
  const sortOrder = Math.max(1, Math.floor(asFiniteNumber(record.sortOrder ?? record.order, 1)));
  const tags = normalizeNotebookTags(record.tags) ?? [];
  const htmlPath = asString(record.htmlPath).trim() || `/notebooks/${notebookId}.html`;
  const colabUrl = normalizeColabUrl(asString(record.colabUrl), notebookId);
  const videoUrl = asString(record.videoUrl).trim() || undefined;
  const createdAt = asString(record.createdAt).trim() || undefined;
  const updatedAt = asString(record.updatedAt).trim() || undefined;

  const chunksRaw = Array.isArray(record.chunks) ? record.chunks : [];
  const chunks = chunksRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const chunk = item as Record<string, unknown>;
      const sectionId = asString(chunk.sectionId).trim();
      const content = asString(chunk.content).trim();
      if (!sectionId || !content) return null;
      return {
        sectionId,
        content,
        position: Math.max(0, Math.floor(asFiniteNumber(chunk.position, 0)))
      };
    })
    .filter((item): item is NotebookChunk => Boolean(item))
    .sort((a, b) => a.position - b.position);

  const sourceRecord = record.source && typeof record.source === "object" ? (record.source as Record<string, unknown>) : null;
  const sourceKind = asString(sourceRecord?.kind).trim();
  const normalizedSourceKind =
    sourceKind === "noema-original" || sourceKind === "open-license-translation" ? sourceKind : null;
  const source: NotebookRecord["source"] =
    sourceRecord && normalizedSourceKind
      ? {
          kind: normalizedSourceKind,
          provider: asString(sourceRecord.provider).trim() || "Noema",
          license: asString(sourceRecord.license).trim() || "internal",
          originalTitle: asString(sourceRecord.originalTitle).trim() || undefined,
          originalUrl: asString(sourceRecord.originalUrl).trim() || undefined,
          translationLanguage: asString(sourceRecord.translationLanguage).trim() || undefined
        }
      : undefined;

  return {
    notebookId,
    title,
    chapterId,
    chapter,
    chapterOrder,
    audience,
    sortOrder,
    tags,
    htmlPath,
    colabUrl,
    videoUrl,
    source,
    chunks,
    createdAt,
    updatedAt
  };
}

export async function listAdminNotebooks() {
  const items: unknown[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await ddb.send(
      new ScanCommand({
        TableName: NOTEBOOKS_TABLE,
        Limit: 1000,
        ExclusiveStartKey: exclusiveStartKey
      })
    );
    items.push(...((response.Items as unknown[] | undefined) ?? []));
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  const notebooks = items
    .map((item) => normalizeNotebookRecord(item))
    .filter((item): item is NotebookRecord => Boolean(item))
    .sort((a, b) => {
    const orderA = Number.isFinite(a.chapterOrder) ? Number(a.chapterOrder) : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b.chapterOrder) ? Number(b.chapterOrder) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const chapterCmp = a.chapter.localeCompare(b.chapter);
    if (chapterCmp !== 0) return chapterCmp;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });

  return {
    writePolicy: getContentWritePolicy(),
    items: notebooks.map((item) => ({
      notebookId: item.notebookId,
      title: item.title,
      chapter: item.chapter,
      sortOrder: item.sortOrder,
      tags: Array.isArray(item.tags) ? item.tags : [],
      htmlPath: item.htmlPath,
      colabUrl: item.colabUrl,
      videoUrl: item.videoUrl || ""
    }))
  };
}

function chunksToFallbackIpynbRaw(chunks: NotebookChunk[]): string {
  return `${JSON.stringify(
    {
      cells: chunks.map((chunk) => ({
        cell_type: "markdown",
        source: [chunk.content]
      }))
    },
    null,
    2
  )}\n`;
}

async function loadStoredNotebookIpynbRaw(notebookId: string, fallbackChunks: NotebookChunk[]): Promise<string> {
  if (NOTEBOOK_BUCKET) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: NOTEBOOK_BUCKET,
          Key: `notebooks/${notebookId}.ipynb`
        })
      );
      const raw = await streamBodyToString(response.Body);
      if (raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as NotebookFile;
          const canonical = canonicalizeNotebookFile(parsed);
          return `${JSON.stringify(canonical, null, 2)}\n`;
        } catch {
          return raw;
        }
      }
    } catch {
      // fall through to chunk-based fallback
    }
  }

  const fallback = chunksToFallbackIpynbRaw(fallbackChunks);
  try {
    const parsed = JSON.parse(fallback) as NotebookFile;
    const canonical = canonicalizeNotebookFile(parsed);
    return `${JSON.stringify(canonical, null, 2)}\n`;
  } catch {
    return fallback;
  }
}

async function loadSourceNotebookIpynbRaw(notebookId: string): Promise<string> {
  const localPath = path.join(process.cwd(), "content", "notebooks", `${notebookId}.ipynb`);

  try {
    return await fs.readFile(localPath, "utf8");
  } catch {
    // fall through to GitHub raw source
  }

  const response = await fetch(buildSourceNotebookRawUrl(notebookId));
  if (!response.ok) {
    throw new Error(`Source notebook not found (${response.status})`);
  }
  return await response.text();
}

export async function getAdminNotebookDetail(notebookId: string) {
  const existing = await getNotebook(notebookId);
  if (!existing) return null;

  const ipynbRaw = await loadStoredNotebookIpynbRaw(notebookId, existing.chunks ?? []);

  return {
    notebook: {
      id: existing.notebookId,
      title: existing.title,
      chapter: existing.chapter,
      sortOrder: existing.sortOrder,
      tags: existing.tags ?? [],
      colabUrl: existing.colabUrl,
      videoUrl: existing.videoUrl || "",
      htmlPath: existing.htmlPath,
      updatedAt: existing.updatedAt || ""
    },
    ipynbRaw
  };
}

export async function downloadNotebookIpynb(notebookId: string): Promise<APIGatewayProxyStructuredResultV2 | null> {
  const existing = await getNotebook(notebookId);
  if (!existing) return null;

  let ipynbRaw = "";
  try {
    ipynbRaw = await loadSourceNotebookIpynbRaw(notebookId);
  } catch {
    ipynbRaw = await loadStoredNotebookIpynbRaw(notebookId, existing.chunks ?? []);
  }
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/x-ipynb+json; charset=utf-8",
      "content-disposition": `attachment; filename="${notebookId}.ipynb"`,
      "cache-control": "public, max-age=0, must-revalidate"
    },
    body: ipynbRaw
  };
}

export async function proposeAdminNotebookPatch(
  notebookId: string,
  input: AdminNotebookLlmPatchInput,
  user: AuthUser
) {
  const existing = await getNotebook(notebookId);
  if (!existing) {
    throw new Error("Notebook not found.");
  }

  await putAccessLog(user.userId, notebookId, "ADMIN_PATCH_PROPOSAL");
  const currentIpynbRaw = await loadStoredNotebookIpynbRaw(notebookId, existing.chunks ?? []);
  const generated = await generateNotebookPatchWithLlm(currentIpynbRaw, input);
  const unifiedDiff = buildUnifiedDiff(
    currentIpynbRaw,
    generated.proposedIpynbRaw,
    `a/notebooks/${notebookId}.ipynb`,
    `b/notebooks/${notebookId}.ipynb`
  );

  return {
    notebookId,
    summary: generated.summary,
    currentIpynbRaw,
    proposedIpynbRaw: generated.proposedIpynbRaw,
    unifiedDiff,
    model: {
      provider: generated.provider,
      modelId: generated.modelId
    },
    tokensUsed: generated.tokensUsed,
    generatedAt: nowIso()
  };
}

export async function previewAdminNotebook(input: AdminNotebookPreviewInput, user: AuthUser) {
  if (input.notebookId) {
    await putAccessLog(user.userId, input.notebookId, "ADMIN_NOTEBOOK_PREVIEW");
  }

  let notebookJson: NotebookFile;
  try {
    notebookJson = JSON.parse(input.ipynbRaw) as NotebookFile;
  } catch {
    throw new Error("Invalid ipynb JSON");
  }

  const canonical = canonicalizeNotebookFile(notebookJson);
  const html = notebookToHtml(canonical);

  return {
    html,
    generatedAt: nowIso()
  };
}

export async function putAdminNotebook(notebookId: string, input: AdminNotebookPutInput): Promise<boolean> {
  const existing = await getNotebook(notebookId);
  if (!existing) return false;

  const title = input.title?.trim() || existing.title;
  const chapter = input.chapter?.trim() || existing.chapter;
  const sortOrder =
    input.sortOrder !== undefined && Number.isFinite(input.sortOrder)
      ? Math.max(1, Math.floor(input.sortOrder))
      : existing.sortOrder;
  const tags = Array.isArray(input.tags) ? input.tags : existing.tags ?? [];
  const colabUrl = normalizeColabUrl(input.colabUrl?.trim() || existing.colabUrl, notebookId);
  const videoUrl = input.videoUrl !== undefined ? input.videoUrl.trim() : existing.videoUrl || "";

  let htmlPath = existing.htmlPath;
  let chunks = existing.chunks ?? [];

  if (typeof input.ipynbRaw === "string") {
    let notebookJson: NotebookFile;
    try {
      notebookJson = JSON.parse(input.ipynbRaw) as NotebookFile;
    } catch {
      throw new Error("Invalid ipynb JSON");
    }

    const canonicalNotebook = canonicalizeNotebookFile(notebookJson);
    const canonicalRaw = `${JSON.stringify(canonicalNotebook, null, 2)}\n`;
    const html = notebookToHtml(canonicalNotebook);
    chunks = extractChunks(canonicalNotebook);

    const stored = await saveNotebookArtifacts(notebookId, html, canonicalRaw);
    htmlPath = stored.htmlPath;
  }

  const baseItem: Omit<NotebookRecord, "chunks"> = {
    notebookId,
    title,
    chapterId: existing.chapterId || resolveCanonicalChapterId("", chapter),
    chapter,
    chapterOrder: Number.isFinite(existing.chapterOrder) ? Number(existing.chapterOrder) : undefined,
    audience: existing.audience,
    sortOrder,
    tags,
    htmlPath,
    colabUrl,
    videoUrl: videoUrl || undefined,
    source: existing.source,
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  const compactedChunks = compactChunksForDynamo(baseItem, chunks);

  await ddb.send(
    new PutCommand({
      TableName: NOTEBOOKS_TABLE,
      Item: {
        ...baseItem,
        chunks: compactedChunks
      }
    })
  );

  return true;
}

export async function patchAdminNotebook(input: AdminNotebookPatchInput): Promise<boolean> {
  const existing = await getNotebook(input.notebookId);
  if (!existing) return false;

  const title = input.title ?? existing.title;
  const chapter = input.chapter ?? existing.chapter;
  const sortOrder =
    input.sortOrder !== undefined && Number.isFinite(input.sortOrder)
      ? Math.max(1, Math.floor(input.sortOrder))
      : existing.sortOrder;
  const tags = input.tags ?? existing.tags ?? [];
  const colabUrl = normalizeColabUrl(input.colabUrl ?? existing.colabUrl, existing.notebookId);
  const videoUrl = input.videoUrl !== undefined ? input.videoUrl : existing.videoUrl;

  const baseItem: Omit<NotebookRecord, "chunks"> = {
    notebookId: existing.notebookId,
    title,
    chapterId: existing.chapterId || resolveCanonicalChapterId("", chapter),
    chapter,
    chapterOrder: Number.isFinite(existing.chapterOrder) ? Number(existing.chapterOrder) : undefined,
    audience: existing.audience,
    sortOrder,
    tags,
    htmlPath: existing.htmlPath,
    colabUrl,
    videoUrl: videoUrl || undefined,
    source: existing.source,
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  const compactedChunks = compactChunksForDynamo(baseItem, existing.chunks ?? []);

  await ddb.send(
    new PutCommand({
      TableName: NOTEBOOKS_TABLE,
      Item: {
        ...baseItem,
        chunks: compactedChunks
      }
    })
  );

  return true;
}

export async function deleteAdminNotebook(notebookId: string): Promise<boolean> {
  const existing = await getNotebook(notebookId);
  if (!existing) return false;

  await ddb.send(
    new DeleteCommand({
      TableName: NOTEBOOKS_TABLE,
      Key: { notebookId }
    })
  );

  if (NOTEBOOK_BUCKET) {
    const keys = new Set([`notebooks/${notebookId}.html`, `notebooks/${notebookId}.ipynb`]);

    const fromHtmlPath = asString(existing.htmlPath).replace(/^\//, "");
    if (fromHtmlPath.startsWith("notebooks/")) {
      keys.add(fromHtmlPath);
    }

    await Promise.all(
      Array.from(keys).map((key) =>
        s3
          .send(
            new DeleteObjectCommand({
              Bucket: NOTEBOOK_BUCKET,
              Key: key
            })
          )
          .catch(() => undefined)
      )
    );
  }

  return true;
}

export async function patchAdminAnswer(questionId: string, answerText: string): Promise<boolean> {
  const question = await getQuestion(questionId);
  if (!question) return false;

  const references: SourceReference[] = [{ notebookId: question.notebookId, location: `#${question.sectionId}` }];
  const ts = nowIso();

  await upsertAnswer({
    questionId,
    answerText,
    sourceReferences: references,
    tokensPrompt: 0,
    tokensCompletion: 0,
    modelId: "admin-edited",
    latencyMs: 0,
    createdAt: ts,
    updatedAt: ts
  });

  await ddb.send(
    new UpdateCommand({
      TableName: QUESTIONS_TABLE,
      Key: { questionId },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt REMOVE lastError",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "COMPLETED",
        ":updatedAt": ts
      }
    })
  );

  const cacheKey = toCacheKey(question.questionHash, question.notebookId, question.sectionId);
  await putCachedAnswer(cacheKey, {
    answerText,
    sourceReferences: references,
    tokensUsed: 0,
    modelId: "admin-edited",
    timestamp: ts
  });

  return true;
}

function slugify(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (base) return base;

  const digest = Buffer.from(value, "utf8").toString("hex").slice(0, 12);
  return `section-${digest}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlWithLineBreaks(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

type NotebookCell = {
  cell_type: "markdown" | "code";
  source?: string[] | string;
};

type NotebookFile = {
  cells?: NotebookCell[];
};

function normalizeMarkdownText(value: string): string {
  if (value.includes("\n")) return value;
  return value.replace(/(?<!\\)\\r\\n/g, "\n").replace(/(?<!\\)\\n/g, "\n");
}

function normalizeCodeText(value: string): string {
  if (value.includes("\n")) return value;

  let out = "";
  let i = 0;
  let quote: "'" | '"' | null = null;
  let triple = false;

  while (i < value.length) {
    const ch = value[i];

    if (!quote) {
      if (ch === "'" || ch === '"') {
        const isTriple = value[i + 1] === ch && value[i + 2] === ch;
        quote = ch;
        triple = isTriple;
        if (isTriple) {
          out += ch.repeat(3);
          i += 3;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }

      if (ch === "\\" && value[i + 1] === "r" && value[i + 2] === "\\" && value[i + 3] === "n") {
        out += "\n";
        i += 4;
        continue;
      }
      if (ch === "\\" && value[i + 1] === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (ch === "\\" && value[i + 1] === "t") {
        out += "\t";
        i += 2;
        continue;
      }

      out += ch;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      if (i + 1 < value.length) {
        out += value[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (triple && ch === quote && value[i + 1] === quote && value[i + 2] === quote) {
      out += ch.repeat(3);
      quote = null;
      triple = false;
      i += 3;
      continue;
    }

    if (!triple && ch === quote) {
      out += ch;
      quote = null;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function sourceToText(source: NotebookCell["source"]): string {
  if (Array.isArray(source)) {
    return source.map((line) => String(line)).join("");
  }
  if (typeof source === "string") {
    return source;
  }
  return "";
}

function normalizeCellSource(cell: NotebookCell): string {
  const text = sourceToText(cell.source);
  if (cell.cell_type === "markdown") {
    return normalizeMarkdownText(text);
  }
  return normalizeCodeText(text);
}

function canonicalizeNotebookFile<T extends { cells?: Array<{ cell_type?: unknown; source?: unknown }> }>(input: T): T {
  if (!Array.isArray(input.cells)) {
    return input;
  }

  const normalizedCells = input.cells.map((cellLike) => {
    const cell = cellLike as NotebookCell;
    if (!cell || (cell.cell_type !== "markdown" && cell.cell_type !== "code")) {
      return cellLike;
    }

    return {
      ...cellLike,
      source: [normalizeCellSource(cell)]
    };
  });

  return {
    ...input,
    cells: normalizedCells
  };
}

function shouldRenderBracketedMathInline(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (/\\\\|\\begin\{|\\end\{/.test(trimmed)) return false;
  return true;
}

function normalizeMathDelimiters(value: string): string {
  return value
    .replace(/\\\[((?:[\s\S]*?))\\\]/g, (_, expr: string) => {
      const trimmed = expr.trim();
      return shouldRenderBracketedMathInline(trimmed) ? `$${trimmed}$` : `$$\n${trimmed}\n$$`;
    })
    .replace(/\\\(((?:[\s\S]*?))\\\)/g, (_, expr: string) => `$${expr.trim()}$`);
}

function isLikelyIdentifierStyleToken(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(value)) return false;
  const [base, ...segments] = value.split("_");
  if (base.length <= 2 && segments.every((segment) => segment.length <= 3)) return false;
  return true;
}

function isLikelyInlineMathExpression(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > 64) return false;
  if (/[\r\n`]/.test(trimmed)) return false;
  if (!/[_^]/.test(trimmed)) return false;
  if (/https?:|www\.|\.com\b|\/\//.test(trimmed)) return false;
  if (/['"]/.test(trimmed)) return false;
  if (isLikelyIdentifierStyleToken(trimmed)) return false;
  if (!/[\\^{}()]/.test(trimmed)) {
    return /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(trimmed) && /^[A-Za-z]_[A-Za-z0-9]+$/.test(trimmed);
  }
  return /^[A-Za-z\\][A-Za-z0-9\\_^{}()[\]+\-*/=|,:.]*$/.test(trimmed);
}

function normalizeInlineMathCodeSpans(value: string): string {
  return value.replace(/([ \t]?)(`([^`\n]+)`)([ \t]?)/g, (match, leadingSpace: string, _fullCode: string, codeText: string, trailingSpace: string) => {
    const normalized = String(codeText || "").trim();
    if (!normalized) return match;
    if (!/\\[A-Za-z]+/.test(normalized) && !isLikelyInlineMathExpression(normalized)) return match;
    const left = leadingSpace || "";
    const right = trailingSpace || "";
    return `${left}$${normalized}$${right}`;
  });
}

function normalizeBareInlineMathLikeExpressions(value: string): string {
  let out = "";
  let index = 0;
  let inInlineMath = false;
  let inBlockMath = false;
  let inCodeSpan = false;
  let inEquationEnv = false;

  while (index < value.length) {
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\begin{equation", index)) {
      inEquationEnv = true;
    }
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\end{equation", index)) {
      inEquationEnv = false;
    }

    if (!inCodeSpan && value.startsWith("$$", index)) {
      inBlockMath = !inBlockMath;
      out += "$$";
      index += 2;
      continue;
    }

    const ch = value[index];

    if (!inInlineMath && !inBlockMath && ch === "`") {
      inCodeSpan = !inCodeSpan;
      out += ch;
      index += 1;
      continue;
    }

    if (!inCodeSpan && !inBlockMath && ch === "$") {
      inInlineMath = !inInlineMath;
      out += ch;
      index += 1;
      continue;
    }

    if (!inInlineMath && !inBlockMath && !inCodeSpan && !inEquationEnv && /[A-Za-z\\]/.test(ch)) {
      let end = index;
      while (end < value.length && /[A-Za-z0-9\\_^{}()[\]+\-*/=|,:.]/.test(value[end])) {
        end += 1;
      }

      const candidate = value.slice(index, end);
      if (isLikelyInlineMathExpression(candidate)) {
        const nextChar = value[end] || "";
        out += `$${candidate}$`;
        if (nextChar === " " || nextChar === "\t") {
          out += nextChar;
          index = end + 1;
          continue;
        }
        index = end;
        continue;
      }
    }

    out += ch;
    index += 1;
  }

  return out;
}

const markdownRenderer = (() => {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: true
  });

  md.use(markdownItKatex);

  const fallbackHeadingOpen = md.renderer.rules.heading_open;
  type HeadingOpenRule = NonNullable<typeof fallbackHeadingOpen>;
  const headingOpenRule: HeadingOpenRule = (tokens, idx, options, env, self) => {
    const inlineToken = tokens[idx + 1];
    const headingText = inlineToken && inlineToken.type === "inline" ? inlineToken.content : "";
    const id = slugify(headingText);
    if (id) {
      tokens[idx].attrSet("id", id);
    }
    if (fallbackHeadingOpen) {
      return fallbackHeadingOpen(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.heading_open = headingOpenRule;

  return md;
})();

const YOUTUBE_DIRECTIVE_GLOBAL_RE = /^\s*@\[(?:youtube|yt)\]\((https?:\/\/[^\s)]+)\)\s*$/gim;
const REFERENCE_VIDEO_HEADING_RE = /^#{1,6}\s*参考動画(?:（外部）|\(外部\))?\s*$/;
const MARKDOWN_LINK_ONLY_LINE_RE = /^(\s*(?:[-*+]\s+|\d+\.\s+)?)\[(.+?)\]\((https?:\/\/[^\s)]+)\)\s*$/;

function extractYouTubeDirectiveUrls(markdownText: string): string[] {
  return Array.from(markdownText.matchAll(YOUTUBE_DIRECTIVE_GLOBAL_RE), (match) => match[1]?.trim() || "").filter(Boolean);
}

function stripYouTubeDirective(markdownText: string): string {
  return markdownText.replace(YOUTUBE_DIRECTIVE_GLOBAL_RE, "").trim();
}

function toYouTubeEmbedUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYouTubeHost =
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be";
  if (!isYouTubeHost) return null;

  let videoId = "";
  if (host === "youtu.be") {
    videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else if (parsed.pathname === "/watch") {
    videoId = (parsed.searchParams.get("v") || "").trim();
  } else if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
    videoId = parsed.pathname.split("/")[2] || "";
  }

  if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  const listId = (parsed.searchParams.get("list") || "").trim();
  if (listId && /^[A-Za-z0-9_-]{8,64}$/.test(listId)) {
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}`;
  }

  return null;
}

function buildYouTubeEmbedHtmlFromUrl(rawUrl: string): string {
  const embedUrl = toYouTubeEmbedUrl(rawUrl);
  if (!embedUrl) return "";
  return [
    '<section class="yt-embed" style="margin:.9rem 0 1.2rem;">',
    '<div style="position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;border:1px solid rgba(138,159,194,.36);background:#0a1322;">',
    `<iframe src="${embedUrl}" title="YouTube lecture reference" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe>`,
    "</div>",
    "</section>"
  ].join("");
}

function renderMarkdownWithInlineYouTubeEmbeds(markdownText: string): string[] {
  const pieces: string[] = [];
  const buffer: string[] = [];
  let inReferenceVideoSection = false;

  const flushBuffer = () => {
    const bufferedMarkdown = buffer.join("\n").trim();
    buffer.length = 0;
    if (bufferedMarkdown) {
      pieces.push(markdownRenderer.render(bufferedMarkdown));
    }
  };

  for (const line of markdownText.split("\n")) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushBuffer();
      inReferenceVideoSection = REFERENCE_VIDEO_HEADING_RE.test(trimmed);
      buffer.push(line);
      continue;
    }

    const linkOnlyMatch = inReferenceVideoSection ? line.match(MARKDOWN_LINK_ONLY_LINE_RE) : null;
    const youtubeUrl = linkOnlyMatch ? linkOnlyMatch[3]?.trim() || "" : "";
    const youtubeEmbedHtml = youtubeUrl ? buildYouTubeEmbedHtmlFromUrl(youtubeUrl) : "";

    if (youtubeEmbedHtml) {
      flushBuffer();
      pieces.push(markdownRenderer.render(line));
      pieces.push(youtubeEmbedHtml);
      continue;
    }

    buffer.push(line);
  }

  flushBuffer();
  return pieces;
}

function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = normalizeCellSource(cell).trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      const normalizedMarkdown = normalizeMathDelimiters(text);
      const visibleMarkdown = stripYouTubeDirective(
        normalizeBareInlineMathLikeExpressions(normalizeInlineMathCodeSpans(normalizedMarkdown))
      );
      if (visibleMarkdown) {
        pieces.push(...renderMarkdownWithInlineYouTubeEmbeds(visibleMarkdown));
      }
      for (const directiveUrl of extractYouTubeDirectiveUrls(normalizedMarkdown)) {
        const youtubeEmbedHtml = buildYouTubeEmbedHtmlFromUrl(directiveUrl);
        if (youtubeEmbedHtml) {
          pieces.push(youtubeEmbedHtml);
        }
      }
      continue;
    }

    pieces.push(`<pre><code class="language-python">${escapeHtml(text)}</code></pre>`);
  }

  pieces.push("</article>");
  return pieces.join("\n");
}

function extractChunks(input: NotebookFile): NotebookChunk[] {
  const chunks: NotebookChunk[] = [];
  let sectionId = "intro";
  let position = 0;

  for (const cell of input.cells ?? []) {
    const raw = normalizeCellSource(cell).trim();
    if (!raw) continue;

    if (cell.cell_type === "markdown") {
      const heading = raw
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^#{1,3}\s+/.test(line));
      if (heading) {
        sectionId = slugify(heading.replace(/^#{1,3}\s+/, "")) || sectionId;
      }
    }

    chunks.push({
      sectionId,
      content: raw.replace(/\s+/g, " ").trim(),
      position: position++
    });
  }

  return chunks;
}

function parseMultipart(event: APIGatewayProxyEventV2) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match || !event.body) {
    return null;
  }

  const boundary = (match[1] || match[2] || "").trim();
  if (!boundary) return null;

  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const parts = raw.split(`--${boundary}`);
  const fields: Record<string, string> = {};
  let fileContent = "";

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === "--") continue;

    const divider = trimmed.indexOf("\r\n\r\n");
    if (divider < 0) continue;

    const headers = trimmed.slice(0, divider);
    const body = trimmed.slice(divider + 4).replace(/\r\n$/, "");

    const disposition = headers
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-disposition:"));
    if (!disposition) continue;

    const nameMatch = disposition.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const name = nameMatch[1];
    const filenameMatch = disposition.match(/filename="([^"]+)"/i);

    if (filenameMatch) {
      fileContent = body;
    } else {
      fields[name] = body;
    }
  }

  return { fields, fileContent };
}

function estimateBytes(value: unknown): number {
  const marshalled = marshall(value as Record<string, unknown>, {
    removeUndefinedValues: true
  });
  return Buffer.byteLength(JSON.stringify(marshalled), "utf8");
}

function compactChunksForDynamo(baseItem: Omit<NotebookRecord, "chunks">, chunks: NotebookChunk[]): NotebookChunk[] {
  let compacted = chunks.map((chunk) => ({
      sectionId: chunk.sectionId,
      position: chunk.position,
      content: chunk.content.slice(0, MAX_CHUNK_CHARACTERS)
    }));

  while (compacted.length > 0 && estimateBytes({ ...baseItem, chunks: compacted }) > DYNAMODB_ITEM_SOFT_LIMIT_BYTES) {
    compacted = compacted.slice(0, compacted.length - 1);
  }

  return compacted;
}

async function saveNotebookArtifacts(notebookId: string, html: string, ipynbRaw: string) {
  if (!NOTEBOOK_BUCKET) {
    return { htmlPath: `/notebooks/${notebookId}.html` };
  }

  const htmlKey = `notebooks/${notebookId}.html`;
  const ipynbKey = `notebooks/${notebookId}.ipynb`;

  await s3.send(
    new PutObjectCommand({
      Bucket: NOTEBOOK_BUCKET,
      Key: htmlKey,
      Body: html,
      ContentType: "text/html; charset=utf-8"
    })
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: NOTEBOOK_BUCKET,
      Key: ipynbKey,
      Body: ipynbRaw,
      ContentType: "application/x-ipynb+json"
    })
  );

  return {
    htmlPath: `/${htmlKey}`
  };
}

async function upsertNotebook(item: NotebookRecord) {
  const existing = await getNotebook(item.notebookId);
  const normalizedColabUrl = normalizeColabUrl(item.colabUrl, item.notebookId);
  const baseItem: Omit<NotebookRecord, "chunks"> = {
    notebookId: item.notebookId,
    title: item.title,
    chapterId: item.chapterId || existing?.chapterId || resolveCanonicalChapterId("", item.chapter),
    chapter: item.chapter,
    chapterOrder:
      Number.isFinite(item.chapterOrder) ? Number(item.chapterOrder) : Number.isFinite(existing?.chapterOrder) ? Number(existing?.chapterOrder) : undefined,
    audience: item.audience || existing?.audience,
    sortOrder: item.sortOrder,
    tags: item.tags,
    htmlPath: item.htmlPath,
    colabUrl: normalizedColabUrl,
    videoUrl: item.videoUrl,
    source: item.source || existing?.source,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  const compactedChunks = compactChunksForDynamo(baseItem, item.chunks ?? []);
  if ((item.chunks?.length ?? 0) > compactedChunks.length) {
    console.warn(
      `Notebook chunks truncated for ${item.notebookId}: ${(item.chunks?.length ?? 0).toString()} -> ${compactedChunks.length.toString()}`
    );
  }

  await ddb.send(
    new PutCommand({
      TableName: NOTEBOOKS_TABLE,
      Item: {
        ...baseItem,
        chunks: compactedChunks
      }
    })
  );
}

export async function upsertNotebookFromEvent(event: APIGatewayProxyEventV2): Promise<string> {
  const contentType = (event.headers["content-type"] || event.headers["Content-Type"] || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const parsed = parseMultipart(event);
    if (!parsed) {
      throw new Error("Invalid multipart body.");
    }

    const title = (parsed.fields.title || "").trim();
    const chapter = (parsed.fields.chapter || "").trim();
    const order = Number(parsed.fields.order || 1);
    const notebookId = slugify((parsed.fields.id || "").trim() || title);
    const colabUrl = normalizeColabUrl((parsed.fields.colabUrl || "").trim(), notebookId);
    const videoUrl = (parsed.fields.videoUrl || "").trim() || undefined;
    const tags = (parsed.fields.tags || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!title || !chapter || !notebookId || !parsed.fileContent) {
      throw new Error("title/chapter/file are required");
    }

    let notebookJson: NotebookFile;
    try {
      notebookJson = JSON.parse(parsed.fileContent) as NotebookFile;
    } catch {
      throw new Error("Invalid ipynb format");
    }

    const canonicalNotebook = canonicalizeNotebookFile(notebookJson);
    const canonicalRaw = `${JSON.stringify(canonicalNotebook, null, 2)}\n`;
    const html = notebookToHtml(canonicalNotebook);
    const chunks = extractChunks(canonicalNotebook);
    const stored = await saveNotebookArtifacts(notebookId, html, canonicalRaw);

    await upsertNotebook({
      notebookId,
      title,
      chapter,
      sortOrder: Number.isFinite(order) ? order : 1,
      tags,
      htmlPath: stored.htmlPath,
      colabUrl,
      videoUrl,
      chunks
    });

    return notebookId;
  }

  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) {
    throw new Error("Invalid JSON body.");
  }

  const title = asString(payload.title).trim();
  const chapter = asString(payload.chapter).trim();
  const order = Number(payload.order ?? 1);
  const notebookId = slugify(asString(payload.notebookId).trim() || title);
  const colabUrl = normalizeColabUrl(asString(payload.colabUrl).trim(), notebookId);
  const videoUrl = asString(payload.videoUrl).trim() || undefined;
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const chunks = Array.isArray(payload.chunks)
    ? payload.chunks
        .map((chunk, idx) => {
          if (!chunk || typeof chunk !== "object") return null;
          const item = chunk as Record<string, unknown>;
          const content = normalizeMarkdownText(asString(item.content)).trim();
          if (!content) return null;
          return {
            sectionId: asString(item.sectionId).trim() || "intro",
            content,
            position: Number.isFinite(Number(item.position)) ? Number(item.position) : idx
          } as NotebookChunk;
        })
        .filter(Boolean) as NotebookChunk[]
    : [];

  if (!title || !chapter || !notebookId) {
    throw new Error("title/chapter are required");
  }

  const providedHtml = asString(payload.html).trim();
  const html =
    providedHtml ||
    [
      '<article class="prose-noema">',
      ...chunks.map((chunk) => `<p id="${escapeHtml(chunk.sectionId)}">${escapeHtmlWithLineBreaks(chunk.content)}</p>`),
      "</article>"
    ].join("\n");

  const ipynbRaw = `${JSON.stringify({
    cells: chunks.map((chunk) => ({
      cell_type: "markdown",
      source: [chunk.content]
    }))
  }, null, 2)}\n`;

  const stored = await saveNotebookArtifacts(notebookId, html, ipynbRaw);

  await upsertNotebook({
    notebookId,
    title,
    chapter,
    sortOrder: Number.isFinite(order) ? order : 1,
    tags,
    htmlPath: stored.htmlPath,
    colabUrl,
    videoUrl,
    chunks
  });

  return notebookId;
}

function normalizeExpectedModules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (seen.size >= 24) break;
    const moduleName = normalizePythonModuleName(asString(item));
    if (!moduleName) continue;
    seen.add(moduleName);
  }

  return Array.from(seen);
}

export function getContentWritePolicy(): ContentWritePolicy {
  const mode = CONTENT_WRITE_MODE_RAW === "aws_direct" ? "aws_direct" : "github_ssot";
  const canWrite = mode === "aws_direct";
  const canCreate = canWrite || Boolean(NOTEBOOK_BUCKET);
  return {
    mode,
    canWrite,
    canCreate,
    githubRepo: CONTENT_GITHUB_REPO,
    githubRef: CONTENT_GITHUB_REF
  };
}

export function assertAdminContentWritable() {
  const policy = getContentWritePolicy();
  if (policy.canWrite) return;
  throw new Error(
    `GitHub正本モードのため管理画面からの直接保存は無効です。GitHub (${policy.githubRepo}@${policy.githubRef}) へPR/commitしてください。`
  );
}

export function assertAdminNotebookCreatable() {
  const policy = getContentWritePolicy();
  if (policy.canCreate) return;
  throw new Error(
    `この環境では新規教材追加の保存先が未設定です。NOTEBOOK_BUCKET を設定するか、GitHub (${policy.githubRepo}@${policy.githubRef}) 側で教材を追加してください。`
  );
}

async function invokePythonRunnerOnce(
  functionName: string,
  payload: Record<string, unknown>
): Promise<PythonRunnerInvokeResponse> {
  if (!functionName) {
    throw new Error("Python runner function name is empty.");
  }

  const invokeResult = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(payload), "utf8")
    })
  );

  const rawPayload = invokeResult.Payload ? Buffer.from(invokeResult.Payload).toString("utf8") : "{}";

  let decoded: PythonRunnerInvokeResponse = {};
  try {
    decoded = JSON.parse(rawPayload) as PythonRunnerInvokeResponse;
  } catch {
    throw new Error(`${functionName} returned a non-JSON response.`);
  }

  if (invokeResult.FunctionError) {
    const message = asString(decoded.errorMessage || decoded.errorType || "Python runner invocation failed.");
    throw new Error(`${functionName}: ${message}`);
  }

  return decoded;
}

function appendRunnerFallbackNotice(
  decoded: PythonRunnerInvokeResponse,
  primaryFunctionName: string,
  fallbackFunctionName: string,
  reason: string
): PythonRunnerInvokeResponse {
  const prefix =
    `[runtime] Fallback: ${primaryFunctionName} failed (${reason}). Retried on ${fallbackFunctionName}.\n`;
  const stderr = `${prefix}${asString(decoded.stderr)}`;
  return {
    ...decoded,
    stderr: stderr.slice(0, 40_000),
    runnerFallback: true,
    runnerUsed: fallbackFunctionName
  };
}

function buildRunnerInvocationFailureResponse(functionName: string, message: string): PythonRunnerInvokeResponse {
  const text = String(message || "Python runner invocation failed.");
  return {
    ok: false,
    stdout: "",
    stderr: `[runtime] ${functionName}: ${text}`.slice(0, 40_000),
    error: `Python runner invocation failed: ${text}`.slice(0, 2_000),
    errorCode: "RUNNER_INVOCATION_FAILED",
    retryable: true,
    durationMs: 0,
    timedOut: false,
    installedPackages: [],
    failedModules: [],
    outputs: [],
    runnerUsed: functionName
  };
}

async function safeInvokePythonRunnerOnce(
  functionName: string,
  payload: Record<string, unknown>
): Promise<PythonRunnerInvokeResponse> {
  try {
    return await invokePythonRunnerOnce(functionName, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildRunnerInvocationFailureResponse(functionName, message);
  }
}

function responseFailedModules(response: PythonRunnerInvokeResponse): string[] {
  if (!Array.isArray(response.failedModules)) return [];
  return response.failedModules.map((name) => normalizePythonModuleName(asString(name))).filter(Boolean);
}

function responseSuggestsHeavyDependencyFailure(
  response: PythonRunnerInvokeResponse,
  heavyModules: string[]
): boolean {
  if (!heavyModules.length) return false;
  const heavySet = new Set(heavyModules);
  for (const moduleName of responseFailedModules(response)) {
    if (heavySet.has(moduleName)) return true;
  }

  const missingFromStderr = extractMissingPythonModuleFromText(asString(response.stderr));
  if (missingFromStderr && heavySet.has(missingFromStderr)) return true;

  const missingFromError = extractMissingPythonModuleFromText(asString(response.error));
  if (missingFromError && heavySet.has(missingFromError)) return true;

  const message = `${asString(response.error)}\n${asString(response.stderr)}`.toLowerCase();
  return heavyModules.some((moduleName) => message.includes(moduleName.toLowerCase()));
}

async function invokePythonRunner(payload: Record<string, unknown>): Promise<PythonRunnerInvokeResponse> {
  if (!PYTHON_RUNNER_FUNCTION_NAME) {
    throw new Error("PYTHON_RUNNER_FUNCTION_NAME is not configured.");
  }

  const expectedModules = normalizeExpectedModules(payload.expectedModules);
  const importsFromCode = Array.from(
    new Set([
      ...extractImportedPythonModules(asString(payload.contextCode)),
      ...extractImportedPythonModules(asString(payload.code))
    ])
  );

  const requestedHeavyModules = requestedHeavyPythonModules([...importsFromCode, ...expectedModules]);
  const standardPayload = {
    ...payload,
    expectedModules: stripHeavyPythonModules(expectedModules),
    blockedModules: requestedHeavyModules
  };
  const standardResponse = await safeInvokePythonRunnerOnce(PYTHON_RUNNER_FUNCTION_NAME, standardPayload);

  if (!PYTHON_RUNNER_HEAVY_FUNCTION_NAME || requestedHeavyModules.length === 0) {
    return standardResponse;
  }

  const shouldEscalate =
    Boolean(standardResponse.error) && responseSuggestsHeavyDependencyFailure(standardResponse, requestedHeavyModules);
  if (!shouldEscalate) {
    return standardResponse;
  }

  const heavyResponse = await safeInvokePythonRunnerOnce(PYTHON_RUNNER_HEAVY_FUNCTION_NAME, payload);
  if (!heavyResponse.error) {
    return appendRunnerFallbackNotice(
      heavyResponse,
      PYTHON_RUNNER_FUNCTION_NAME,
      PYTHON_RUNNER_HEAVY_FUNCTION_NAME,
      asString(standardResponse.error || standardResponse.stderr || "heavy dependency required")
    );
  }

  return appendRunnerFallbackNotice(
    standardResponse,
    PYTHON_RUNNER_HEAVY_FUNCTION_NAME,
    PYTHON_RUNNER_FUNCTION_NAME,
    asString(heavyResponse.error || heavyResponse.stderr || "heavy runner unavailable")
  );
}

export async function runPythonRuntime(input: PythonRuntimeExecuteInput, user: AuthUser): Promise<PythonRuntimeExecuteResult> {
  await putAccessLog(user.userId, input.notebookId, "RUN_NOTEBOOK_CODE");

  const response = await invokePythonRunner({
    action: "execute",
    notebookId: input.notebookId,
    sectionId: input.sectionId,
    code: input.code,
    contextCode: input.contextCode || "",
    expectedModules: input.expectedModules,
    userId: user.userId
  });

  const installedPackages = Array.isArray(response.installedPackages)
    ? response.installedPackages.map((pkg) => String(pkg).trim()).filter(Boolean).slice(0, 50)
    : [];

  const outputs: PythonRuntimeOutput[] = [];
  if (Array.isArray(response.outputs)) {
    for (const item of response.outputs.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const type = asString((item as Record<string, unknown>).type).trim();
      if (type === "text/plain") {
        const text = asString((item as Record<string, unknown>).text).slice(0, 120_000);
        if (!text) continue;
        outputs.push({ type: "text/plain", text });
        continue;
      }
      if (type === "text/html") {
        const html = asString((item as Record<string, unknown>).html).slice(0, 160_000);
        if (!html) continue;
        outputs.push({ type: "text/html", html });
        continue;
      }
      if (type === "image/png") {
        const data = asString((item as Record<string, unknown>).data).trim();
        if (!data) continue;
        if (data.length > 800_000) continue;
        if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) continue;
        const alt = asString((item as Record<string, unknown>).alt).slice(0, 120);
        outputs.push({ type: "image/png", data: data.replace(/\s+/g, ""), alt: alt || undefined });
      }
    }
  }

  return {
    stdout: asString(response.stdout).slice(0, 40_000),
    stderr: asString(response.stderr).slice(0, 40_000),
    error: asString(response.error) || null,
    errorCode: asString(response.errorCode) || null,
    retryable: Boolean(response.retryable),
    durationMs: toNumber(response.durationMs),
    timedOut: Boolean(response.timedOut),
    installedPackages,
    outputs
  };
}

export async function preloadPythonRuntime(input: PythonRuntimePreloadInput, user: AuthUser) {
  await putAccessLog(user.userId, input.notebookId, "PRELOAD_NOTEBOOK_RUNTIME");

  const response = await safeInvokePythonRunnerOnce(PYTHON_RUNNER_FUNCTION_NAME, {
    action: "preload",
    notebookId: input.notebookId,
    expectedModules: stripHeavyPythonModules(normalizeExpectedModules(input.expectedModules)),
    userId: user.userId
  });

  const installedPackages = Array.isArray(response.installedPackages)
    ? response.installedPackages.map((pkg) => String(pkg).trim()).filter(Boolean).slice(0, 50)
    : [];

  const failedModules = Array.isArray(response.failedModules)
    ? response.failedModules.map((name) => String(name).trim()).filter(Boolean).slice(0, 50)
    : [];

  return {
    ok: Boolean(response.ok ?? true),
    installedPackages,
    failedModules
  };
}

export async function createNotebookColabSession(
  notebookId: string,
  input: NotebookColabSessionInput,
  user: AuthUser
): Promise<NotebookColabSessionResult> {
  if (!NOTEBOOK_BUCKET) {
    throw new Error("NOTEBOOK_BUCKET is not configured.");
  }
  if (!COLAB_NOTEBOOK_BASE_URL) {
    throw new Error("COLAB_NOTEBOOK_BASE_URL is not configured.");
  }

  const existing = await getNotebook(notebookId);
  if (!existing) {
    throw new Error("Notebook not found.");
  }

  let notebookJson: NotebookFile;
  try {
    notebookJson = JSON.parse(input.ipynbRaw) as NotebookFile;
  } catch {
    throw new Error("Invalid ipynb JSON");
  }

  const canonical = canonicalizeNotebookFile(notebookJson);
  const canonicalRaw = `${JSON.stringify(canonical, null, 2)}\n`;
  if (canonicalRaw.length > 3_000_000) {
    throw new Error("Invalid ipynb JSON");
  }

  const nonce = crypto.randomBytes(24).toString("hex");
  const key = `colab-temp/${nonce}.ipynb`;

  await s3.send(
    new PutObjectCommand({
      Bucket: NOTEBOOK_BUCKET,
      Key: key,
      Body: canonicalRaw,
      ContentType: "application/x-ipynb+json",
      CacheControl: "no-store"
    })
  );

  await putAccessLog(user.userId, notebookId, "CREATE_COLAB_SESSION_NOTEBOOK");
  return {
    notebookPath: `/${key}`,
    notebookUrl: `${COLAB_NOTEBOOK_BASE_URL}/${key}`
  };
}

export function parseAskQuestionInput(event: APIGatewayProxyEventV2): AskQuestionInput | null {
  const payload = parseJson<unknown>(event);
  return validateAskQuestionInput(payload);
}

export function parseChatCompleteInput(event: APIGatewayProxyEventV2): ChatCompleteInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const notebookId = asString(payload.notebookId).trim();
  const sectionId = asString(payload.sectionId).trim() || "intro";
  const questionText = asString(payload.questionText).trim();
  const sessionId = asString(payload.sessionId).trim();
  const providerRaw = asString(payload.provider).trim().toLowerCase();
  const modelId = asString(payload.modelId).trim();
  const apiKey = asString(payload.apiKey).trim();

  if (!notebookId || !questionText) return null;
  if (questionText.length > ASSISTANT_INPUT_MAX_CHARS) return null;
  if (sessionId && !/^[A-Za-z0-9:_-]{1,80}$/.test(sessionId)) return null;
  if (providerRaw !== "openai" && providerRaw !== "gemini" && providerRaw !== "bedrock") return null;
  if (modelId && !/^[A-Za-z0-9._:+/-]{1,120}$/.test(modelId)) return null;
  if (apiKey && apiKey.length > 512) return null;

  return {
    notebookId,
    sectionId,
    questionText,
    sessionId: sessionId || undefined,
    provider: providerRaw,
    modelId: modelId || undefined,
    apiKey: apiKey || undefined
  };
}

export function parsePythonRuntimeInput(event: APIGatewayProxyEventV2): PythonRuntimeExecuteInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const notebookId = asString(payload.notebookId).trim();
  const sectionId = asString(payload.sectionId).trim() || "intro";
  const code = asString(payload.code);
  const contextCode = asString(payload.contextCode);
  const expectedModules = normalizeExpectedModules(payload.expectedModules);

  if (!notebookId || !code.trim()) return null;
  if (code.length > MAX_RUNTIME_CODE_CHARS) return null;
  if (contextCode.length > MAX_RUNTIME_CONTEXT_CODE_CHARS) return null;

  return {
    notebookId,
    sectionId,
    code,
    contextCode,
    expectedModules
  };
}

export function parsePythonRuntimePreloadInput(event: APIGatewayProxyEventV2): PythonRuntimePreloadInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const notebookId = asString(payload.notebookId).trim();
  if (!notebookId) return null;

  return {
    notebookId,
    expectedModules: normalizeExpectedModules(payload.expectedModules)
  };
}

export function parseAdminPatchInput(event: APIGatewayProxyEventV2) {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const questionId = asString(payload.questionId).trim();
  const answerText = asString(payload.answerText).trim();
  if (!questionId || !answerText) return null;

  return { questionId, answerText };
}

export function parseAdminNotebookPatchInput(event: APIGatewayProxyEventV2): AdminNotebookPatchInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const notebookId = asString(payload.notebookId).trim();
  if (!notebookId) return null;

  const result: AdminNotebookPatchInput = { notebookId };
  let changed = false;

  if ("title" in payload) {
    const title = asString(payload.title).trim();
    if (!title) return null;
    result.title = title;
    changed = true;
  }

  if ("chapter" in payload) {
    const chapter = asString(payload.chapter).trim();
    if (!chapter) return null;
    result.chapter = chapter;
    changed = true;
  }

  if ("order" in payload || "sortOrder" in payload) {
    const rawOrder = payload.sortOrder ?? payload.order;
    const parsed = Number(rawOrder);
    if (!Number.isFinite(parsed)) return null;
    result.sortOrder = Math.max(1, Math.floor(parsed));
    changed = true;
  }

  if ("tags" in payload) {
    result.tags = normalizeNotebookTags(payload.tags) ?? [];
    changed = true;
  }

  if ("colabUrl" in payload) {
    const colabUrl = asString(payload.colabUrl).trim();
    if (!colabUrl) return null;
    result.colabUrl = colabUrl;
    changed = true;
  }

  if ("videoUrl" in payload) {
    result.videoUrl = asString(payload.videoUrl).trim();
    changed = true;
  }

  if (!changed) return null;
  return result;
}

export function parseAdminNotebookLlmPatchInput(event: APIGatewayProxyEventV2): AdminNotebookLlmPatchInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const instruction = asString(payload.instruction).trim();
  if (!instruction || instruction.length > 4000) {
    return null;
  }

  const selectedTextRaw = asString(payload.selectedText);
  const selectedText = selectedTextRaw.trim() ? selectedTextRaw.slice(0, 8000) : undefined;

  return {
    instruction,
    selectedText
  };
}

export function parseAdminNotebookPreviewInput(event: APIGatewayProxyEventV2): AdminNotebookPreviewInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const ipynbRaw = asString(payload.ipynbRaw);
  if (!ipynbRaw.trim() || ipynbRaw.length > 3_000_000) {
    return null;
  }

  const notebookId = asString(payload.notebookId).trim();
  return {
    notebookId: notebookId || undefined,
    ipynbRaw
  };
}

export function parseNotebookColabSessionInput(event: APIGatewayProxyEventV2): NotebookColabSessionInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const ipynbRaw = asString(payload.ipynbRaw);
  if (!ipynbRaw.trim() || ipynbRaw.length > 3_000_000) {
    return null;
  }

  return { ipynbRaw };
}

export function parseAdminNotebookPutInput(event: APIGatewayProxyEventV2): AdminNotebookPutInput | null {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const result: AdminNotebookPutInput = {};

  if ("title" in payload) {
    const title = asString(payload.title).trim();
    if (!title) return null;
    result.title = title;
  }

  if ("chapter" in payload) {
    const chapter = asString(payload.chapter).trim();
    if (!chapter) return null;
    result.chapter = chapter;
  }

  if ("order" in payload || "sortOrder" in payload) {
    const rawOrder = payload.sortOrder ?? payload.order;
    const parsed = Number(rawOrder);
    if (!Number.isFinite(parsed)) return null;
    result.sortOrder = Math.max(1, Math.floor(parsed));
  }

  if ("tags" in payload) {
    result.tags = normalizeNotebookTags(payload.tags) ?? [];
  }

  if ("colabUrl" in payload) {
    const colabUrl = asString(payload.colabUrl).trim();
    if (!colabUrl) return null;
    result.colabUrl = colabUrl;
  }

  if ("videoUrl" in payload) {
    result.videoUrl = asString(payload.videoUrl);
  }

  if ("ipynbRaw" in payload) {
    const ipynbRaw = asString(payload.ipynbRaw);
    if (!ipynbRaw.trim()) return null;
    result.ipynbRaw = ipynbRaw;
  }

  return result;
}
