import crypto from "crypto";
import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

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
  chapter: string;
  sortOrder: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
  videoUrl?: string;
  chunks?: NotebookChunk[];
  createdAt?: string;
  updatedAt?: string;
};

const DYNAMODB_ITEM_SOFT_LIMIT_BYTES = 350_000;
const MAX_CHUNK_CHARACTERS = 1_200;
const MAX_CHUNKS = 180;

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

type AskQuestionResult = {
  questionId: string;
  status: QuestionStatus;
  cached: boolean;
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

const bedrockRegion = process.env.BEDROCK_REGION || process.env.AWS_REGION;
const bedrockClient = bedrockRegion ? new BedrockRuntimeClient({ region: bedrockRegion }) : null;

const QUESTIONS_TABLE = requiredEnv("QUESTIONS_TABLE");
const ANSWERS_TABLE = requiredEnv("ANSWERS_TABLE");
const CACHE_TABLE = requiredEnv("CACHE_TABLE");
const NOTEBOOKS_TABLE = requiredEnv("NOTEBOOKS_TABLE");
const ACCESS_LOGS_TABLE = requiredEnv("ACCESS_LOGS_TABLE");
const QA_QUEUE_URL = process.env.QA_QUEUE_URL || "";
const NOTEBOOK_BUCKET = process.env.NOTEBOOK_BUCKET || "";

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const INLINE_QA = (process.env.NOEMA_INLINE_QA || "false").toLowerCase() === "true";

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
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseGroups(raw: string): string[] {
  if (!raw.trim()) return [];

  if (raw.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
      }
    } catch {
      // falls back to comma-split.
    }
  }

  return raw
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

  const email = asString(claims.email || "") || null;
  const groups = parseGroups(asString(claims["cognito:groups"] || ""));

  return { userId, email, groups };
}

export function isAdmin(user: AuthUser): boolean {
  if (user.groups.includes("admin")) return true;
  if (user.email && ADMIN_EMAILS.has(user.email.toLowerCase())) return true;
  return false;
}

function validateAskQuestionInput(payload: unknown): AskQuestionInput | null {
  if (!payload || typeof payload !== "object") return null;
  const input = payload as Record<string, unknown>;

  const notebookId = asString(input.notebookId).trim();
  const sectionId = asString(input.sectionId).trim();
  const questionText = asString(input.questionText).trim();

  if (!notebookId || !sectionId || !questionText) return null;
  if (questionText.length > 2000) return null;

  return { notebookId, sectionId, questionText };
}

async function putAccessLog(userId: string, notebookId: string, action: string) {
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

async function getNotebook(notebookId: string): Promise<NotebookRecord | null> {
  const response = await ddb.send(
    new GetCommand({
      TableName: NOTEBOOKS_TABLE,
      Key: { notebookId }
    })
  );

  return (response.Item as NotebookRecord | undefined) ?? null;
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

async function callOpenAI(prompt: string, modelId: string): Promise<ModelResponse> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or OPENAI_API_KEY_SSM_PARAMETER) is not configured.");
  }

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || process.env.BEDROCK_MAX_TOKENS || 800);
  const temperature = Number(process.env.OPENAI_TEMPERATURE || 0.2);

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      input: prompt,
      max_output_tokens: maxOutputTokens,
      temperature
    })
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

async function callBedrock(prompt: string, modelId: string): Promise<ModelResponse> {
  if (!bedrockClient) {
    throw new Error("BEDROCK_REGION is not configured.");
  }

  const response = await bedrockClient.send(
    new ConverseCommand({
      modelId,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: {
        maxTokens: Number(process.env.BEDROCK_MAX_TOKENS || 800),
        temperature: Number(process.env.BEDROCK_TEMPERATURE || 0.2)
      }
    })
  );

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
      answerText: snapshot.answerText,
      sourceReferences: snapshot.sourceReferences,
      tokensPrompt: snapshot.tokensUsed,
      tokensCompletion: 0,
      modelId: snapshot.modelId,
      latencyMs: 0,
      createdAt,
      updatedAt: createdAt
    });

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

  return {
    questionId,
    status: "QUEUED",
    cached: false
  };
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
      answerText: answer.answerText,
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

export async function listQuestionHistory(user: AuthUser, notebookId: string) {
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
  return {
    items: questions
      .map((question) => {
        const answer = answers.get(question.questionId);
        if (!answer) return null;

        return {
          questionId: question.questionId,
          sectionId: question.sectionId,
          questionText: question.questionText,
          answerText: answer.answerText,
          sourceReferences: answer.sourceReferences,
          createdAt: question.createdAt
        };
      })
      .filter(Boolean)
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

type NotebookCell = {
  cell_type: "markdown" | "code";
  source?: string[];
};

type NotebookFile = {
  cells?: NotebookCell[];
};

function markdownToHtml(markdown: string): string {
  if (markdown.startsWith("# ")) {
    const title = markdown.slice(2);
    return `<h1 id="${slugify(title)}">${escapeHtml(title)}</h1>`;
  }
  if (markdown.startsWith("## ")) {
    const title = markdown.slice(3);
    return `<h2 id="${slugify(title)}">${escapeHtml(title)}</h2>`;
  }
  if (markdown.startsWith("### ")) {
    const title = markdown.slice(4);
    return `<h3 id="${slugify(title)}">${escapeHtml(title)}</h3>`;
  }
  return `<p>${escapeHtml(markdown)}</p>`;
}

function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = (cell.source ?? []).join("").trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      for (const line of text.split("\n\n")) {
        pieces.push(markdownToHtml(line.trim()));
      }
      continue;
    }

    pieces.push(`<pre><code>${escapeHtml(text)}</code></pre>`);
  }

  pieces.push("</article>");
  return pieces.join("\n");
}

function extractChunks(input: NotebookFile): NotebookChunk[] {
  const chunks: NotebookChunk[] = [];
  let sectionId = "intro";
  let position = 0;

  for (const cell of input.cells ?? []) {
    const raw = (cell.source ?? []).join("").trim();
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
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function compactChunksForDynamo(baseItem: Omit<NotebookRecord, "chunks">, chunks: NotebookChunk[]): NotebookChunk[] {
  let compacted = chunks
    .slice(0, MAX_CHUNKS)
    .map((chunk) => ({
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
  const baseItem: Omit<NotebookRecord, "chunks"> = {
    notebookId: item.notebookId,
    title: item.title,
    chapter: item.chapter,
    sortOrder: item.sortOrder,
    tags: item.tags,
    htmlPath: item.htmlPath,
    colabUrl: item.colabUrl,
    videoUrl: item.videoUrl,
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  const compactedChunks = compactChunksForDynamo(baseItem, item.chunks ?? []);

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
    const colabUrl = (parsed.fields.colabUrl || "").trim();
    const videoUrl = (parsed.fields.videoUrl || "").trim() || undefined;
    const notebookId = slugify((parsed.fields.id || "").trim() || title);
    const tags = (parsed.fields.tags || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!title || !chapter || !colabUrl || !notebookId || !parsed.fileContent) {
      throw new Error("title/chapter/colabUrl/file are required");
    }

    let notebookJson: NotebookFile;
    try {
      notebookJson = JSON.parse(parsed.fileContent) as NotebookFile;
    } catch {
      throw new Error("Invalid ipynb format");
    }

    const html = notebookToHtml(notebookJson);
    const chunks = extractChunks(notebookJson);
    const stored = await saveNotebookArtifacts(notebookId, html, parsed.fileContent);

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
  const colabUrl = asString(payload.colabUrl).trim();
  const videoUrl = asString(payload.videoUrl).trim() || undefined;
  const notebookId = slugify(asString(payload.notebookId).trim() || title);
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const chunks = Array.isArray(payload.chunks)
    ? payload.chunks
        .map((chunk, idx) => {
          if (!chunk || typeof chunk !== "object") return null;
          const item = chunk as Record<string, unknown>;
          const content = asString(item.content).trim();
          if (!content) return null;
          return {
            sectionId: asString(item.sectionId).trim() || "intro",
            content,
            position: Number.isFinite(Number(item.position)) ? Number(item.position) : idx
          } as NotebookChunk;
        })
        .filter(Boolean) as NotebookChunk[]
    : [];

  if (!title || !chapter || !colabUrl || !notebookId) {
    throw new Error("title/chapter/colabUrl are required");
  }

  const providedHtml = asString(payload.html).trim();
  const html =
    providedHtml ||
    [
      '<article class="prose-noema">',
      ...chunks.map((chunk) => `<p id="${escapeHtml(chunk.sectionId)}">${escapeHtml(chunk.content)}</p>`),
      "</article>"
    ].join("\n");

  const ipynbRaw = JSON.stringify({
    cells: chunks.map((chunk) => ({
      cell_type: "markdown",
      source: [chunk.content]
    }))
  });

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

export function parseAskQuestionInput(event: APIGatewayProxyEventV2): AskQuestionInput | null {
  const payload = parseJson<unknown>(event);
  return validateAskQuestionInput(payload);
}

export function parseAdminPatchInput(event: APIGatewayProxyEventV2) {
  const payload = parseJson<Record<string, unknown>>(event);
  if (!payload) return null;

  const questionId = asString(payload.questionId).trim();
  const answerText = asString(payload.answerText).trim();
  if (!questionId || !answerText) return null;

  return { questionId, answerText };
}
