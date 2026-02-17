import crypto from "crypto";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { JobStatus, QuestionStatus, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const bedrockRegion = process.env.BEDROCK_REGION;
const bedrockClient = bedrockRegion ? new BedrockRuntimeClient({ region: bedrockRegion }) : null;

export const questionInputSchema = z.object({
  notebookId: z.string().min(1),
  sectionId: z.string().min(1),
  questionText: z.string().min(1).max(2000)
});

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

function normalizeQuestion(input: string): string {
  return input.replace(/\s+/g, " ").trim().toLowerCase();
}

function questionHash(input: string): string {
  return crypto.createHash("sha256").update(normalizeQuestion(input)).digest("hex");
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

async function retrieveRelevantChunks(notebookId: string, sectionId: string, questionText: string) {
  const chunks = await prisma.notebookChunk.findMany({ where: { notebookId }, orderBy: { position: "asc" } });
  const tokens = tokenize(questionText);

  const ranked = chunks
    .map((chunk) => {
      const base = scoreChunk(tokens, chunk.content);
      const sectionBoost = chunk.sectionId === sectionId ? 2 : 0;
      return { chunk, score: base + sectionBoost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .filter((item) => item.score > 0);

  if (ranked.length === 0) {
    return chunks.slice(0, 3).map((chunk) => ({ chunk, score: 0 }));
  }

  return ranked;
}

function routeModel(questionText: string, contextChars: number): string | null {
  const small = process.env.BEDROCK_MODEL_SMALL;
  const mid = process.env.BEDROCK_MODEL_MID;
  const large = process.env.BEDROCK_MODEL_LARGE;

  if (questionText.length < 120 && small) return small;
  if (contextChars > 2800 && large) return large;
  if (mid) return mid;
  return small ?? large ?? null;
}

async function callBedrock(prompt: string, modelId: string) {
  if (!bedrockClient) {
    throw new Error("BEDROCK_REGION is not configured.");
  }

  const response = await bedrockClient.send(
    new ConverseCommand({
      modelId,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: {
        maxTokens: Number(process.env.BEDROCK_MAX_TOKENS ?? 800),
        temperature: 0.2
      }
    })
  );

  const text =
    response.output?.message?.content
      ?.map((item) => ("text" in item ? (item.text ?? "") : ""))
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
    "開発モード回答です。Bedrock未設定のため教材文脈から要点を返します。",
    `質問: ${questionText}`,
    "関連コンテキスト:",
    ...contexts.map((text, index) => `${index + 1}. ${text.slice(0, 220)}`),
    "次はこのノートをColabで実行し、変数やハイパーパラメータを変更して挙動を確認してください。"
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
    timestamp: new Date().toISOString()
  };
}

export async function enqueueQuestion(input: z.infer<typeof questionInputSchema>, userId: string) {
  const notebookExists = await prisma.notebook.findUnique({ where: { id: input.notebookId }, select: { id: true } });
  if (!notebookExists) {
    throw new Error("Notebook not found.");
  }

  const hash = questionHash(input.questionText);

  await prisma.accessLog
    .create({
      data: {
        userId,
        notebookId: input.notebookId,
        action: "ASK_QUESTION"
      }
    })
    .catch(() => undefined);

  const cache = await prisma.questionCache.findUnique({
    where: {
      questionHash_notebookId_sectionId: {
        questionHash: hash,
        notebookId: input.notebookId,
        sectionId: input.sectionId
      }
    }
  });

  if (cache && cache.expiresAt > new Date()) {
    const snapshot = cache.answerSnapshot as CachedAnswerSnapshot;
    const question = await prisma.question.create({
      data: {
        userId,
        notebookId: input.notebookId,
        sectionId: input.sectionId,
        questionText: input.questionText,
        questionHash: hash,
        status: QuestionStatus.COMPLETED,
        answer: {
          create: {
            answerText: snapshot.answerText,
            sourceReferences: snapshot.sourceReferences,
            tokensPrompt: snapshot.tokensUsed,
            tokensCompletion: 0,
            modelId: snapshot.modelId,
            latencyMs: 0
          }
        }
      }
    });

    return { questionId: question.id, status: question.status, cached: true };
  }

  const question = await prisma.question.create({
    data: {
      userId,
      notebookId: input.notebookId,
      sectionId: input.sectionId,
      questionText: input.questionText,
      questionHash: hash,
      status: QuestionStatus.QUEUED,
      job: {
        create: {
          status: JobStatus.QUEUED
        }
      }
    }
  });

  return { questionId: question.id, status: question.status, cached: false };
}

export async function processQuestionById(questionId: string): Promise<void> {
  const job = await prisma.processingJob.findUnique({ where: { questionId } });
  if (!job || (job.status !== JobStatus.QUEUED && job.status !== JobStatus.FAILED)) {
    return;
  }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) return;

  const startedAt = Date.now();

  await prisma.processingJob.update({
    where: { questionId },
    data: {
      status: JobStatus.PROCESSING,
      attempts: { increment: 1 },
      lastError: null
    }
  });
  await prisma.question.update({ where: { id: questionId }, data: { status: QuestionStatus.PROCESSING } });

  try {
    const retrieved = await retrieveRelevantChunks(question.notebookId, question.sectionId, question.questionText);
    const contexts = retrieved.map((item) => ({ sectionId: item.chunk.sectionId, content: item.chunk.content }));
    const sourceReferences: SourceReference[] = retrieved.map((item) => ({
      notebookId: question.notebookId,
      location: `#${item.chunk.sectionId}`
    }));

    const prompt = buildPrompt(question.questionText, contexts);
    const modelId = routeModel(question.questionText, contexts.reduce((acc, item) => acc + item.content.length, 0)) ?? "mock";

    let answerText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    if (modelId !== "mock") {
      const result = await callBedrock(prompt, modelId);
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

    await prisma.answer.upsert({
      where: { questionId },
      update: {
        answerText,
        sourceReferences,
        tokensPrompt: inputTokens,
        tokensCompletion: outputTokens,
        modelId,
        latencyMs: Date.now() - startedAt
      },
      create: {
        questionId,
        answerText,
        sourceReferences,
        tokensPrompt: inputTokens,
        tokensCompletion: outputTokens,
        modelId,
        latencyMs: Date.now() - startedAt
      }
    });

    await prisma.question.update({ where: { id: questionId }, data: { status: QuestionStatus.COMPLETED } });
    await prisma.processingJob.update({ where: { questionId }, data: { status: JobStatus.COMPLETED } });

    const snapshot = toSnapshot(answerText, sourceReferences, inputTokens, outputTokens, modelId);
    await prisma.questionCache.upsert({
      where: {
        questionHash_notebookId_sectionId: {
          questionHash: question.questionHash,
          notebookId: question.notebookId,
          sectionId: question.sectionId
        }
      },
      update: {
        answerSnapshot: snapshot,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      },
      create: {
        questionHash: question.questionHash,
        notebookId: question.notebookId,
        sectionId: question.sectionId,
        answerSnapshot: snapshot,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await prisma.question.update({ where: { id: questionId }, data: { status: QuestionStatus.FAILED } });
    await prisma.processingJob.update({
      where: { questionId },
      data: {
        status: JobStatus.FAILED,
        lastError: message,
        runAfter: new Date(Date.now() + 30_000)
      }
    });
  }
}

export async function processNextQueuedJobs(limit = 3): Promise<number> {
  const jobs = await prisma.processingJob.findMany({
    where: {
      status: { in: [JobStatus.QUEUED, JobStatus.FAILED] },
      runAfter: { lte: new Date() },
      attempts: { lt: 5 }
    },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  for (const job of jobs) {
    await processQuestionById(job.questionId);
  }

  return jobs.length;
}

export async function getQuestionAnswer(questionId: string, userId: string, role: Role) {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { answer: true, job: true }
  });

  if (!question) {
    return { kind: "not_found" as const };
  }

  if (role !== Role.ADMIN && question.userId !== userId) {
    return { kind: "forbidden" as const };
  }

  if (question.status === QuestionStatus.FAILED) {
    return {
      kind: "failed" as const,
      status: question.status,
      message: question.job?.lastError ?? "回答生成に失敗しました。しばらくしてから再試行してください。"
    };
  }

  if (question.status !== QuestionStatus.COMPLETED || !question.answer) {
    return {
      kind: "pending" as const,
      status: question.status
    };
  }

  return {
    kind: "completed" as const,
    status: question.status,
    answer: {
      answerText: question.answer.answerText,
      sourceReferences: question.answer.sourceReferences,
      tokensUsed: question.answer.tokensPrompt + question.answer.tokensCompletion,
      timestamp: question.answer.createdAt.toISOString()
    }
  };
}
