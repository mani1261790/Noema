import { QuestionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequestUser, isAdmin } from "@/lib/request-auth";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.question.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { email: true, name: true } },
      answer: true
    }
  });

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      user: row.user,
      notebookId: row.notebookId,
      sectionId: row.sectionId,
      questionText: row.questionText,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      answerText: row.answer?.answerText ?? null
    }))
  });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { questionId?: string; answerText?: string } | null;
  const questionId = body?.questionId?.trim();
  const answerText = body?.answerText?.trim();

  if (!questionId || !answerText) {
    return NextResponse.json({ error: "questionId and answerText are required" }, { status: 400 });
  }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.answer.upsert({
    where: { questionId },
    update: {
      answerText,
      sourceReferences: [{ notebookId: question.notebookId, location: `#${question.sectionId}` }],
      modelId: "admin-edited",
      tokensPrompt: 0,
      tokensCompletion: 0,
      latencyMs: 0
    },
    create: {
      questionId,
      answerText,
      sourceReferences: [{ notebookId: question.notebookId, location: `#${question.sectionId}` }],
      modelId: "admin-edited",
      tokensPrompt: 0,
      tokensCompletion: 0,
      latencyMs: 0
    }
  });

  await prisma.question.update({ where: { id: questionId }, data: { status: QuestionStatus.COMPLETED } });
  await prisma.questionCache.upsert({
    where: {
      questionHash_notebookId_sectionId: {
        questionHash: question.questionHash,
        notebookId: question.notebookId,
        sectionId: question.sectionId
      }
    },
    update: {
      answerSnapshot: {
        answerText,
        sourceReferences: [{ notebookId: question.notebookId, location: `#${question.sectionId}` }],
        tokensUsed: 0,
        modelId: "admin-edited",
        timestamp: new Date().toISOString()
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    },
    create: {
      questionHash: question.questionHash,
      notebookId: question.notebookId,
      sectionId: question.sectionId,
      answerSnapshot: {
        answerText,
        sourceReferences: [{ notebookId: question.notebookId, location: `#${question.sectionId}` }],
        tokensUsed: 0,
        modelId: "admin-edited",
        timestamp: new Date().toISOString()
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  return NextResponse.json({ ok: true });
}
