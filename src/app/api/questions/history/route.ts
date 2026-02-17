import { NextResponse } from "next/server";
import { QuestionStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRequestUser } from "@/lib/request-auth";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const notebookId = searchParams.get("notebookId");
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  }

  const where =
    user.role === Role.ADMIN
      ? { notebookId, status: QuestionStatus.COMPLETED }
      : { notebookId, userId: user.id, status: QuestionStatus.COMPLETED };

  const rows = await prisma.question.findMany({
    where,
    include: { answer: true },
    orderBy: { createdAt: "desc" },
    take: 10
  });

  return NextResponse.json({
    items: rows
      .filter((row) => row.answer)
      .map((row) => ({
        questionId: row.id,
        sectionId: row.sectionId,
        questionText: row.questionText,
        answerText: row.answer?.answerText,
        sourceReferences: row.answer?.sourceReferences,
        createdAt: row.createdAt.toISOString()
      }))
  });
}
