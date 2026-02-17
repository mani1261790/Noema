import { NextResponse } from "next/server";
import { processQuestionById, getQuestionAnswer } from "@/lib/qa";
import { getRequestUser } from "@/lib/request-auth";

export async function GET(request: Request, { params }: { params: { questionId: string } }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if ((process.env.NOEMA_INLINE_QA ?? "true") === "true") {
    await processQuestionById(params.questionId);
  }

  const result = await getQuestionAnswer(params.questionId, user.id, user.role);

  if (result.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (result.kind === "pending") {
    return NextResponse.json(
      {
        questionId: params.questionId,
        status: result.status
      },
      { status: 202 }
    );
  }
  if (result.kind === "failed") {
    return NextResponse.json(
      {
        questionId: params.questionId,
        status: result.status,
        error: result.message
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    questionId: params.questionId,
    status: result.status,
    answerText: result.answer.answerText,
    sourceReferences: result.answer.sourceReferences,
    tokensUsed: result.answer.tokensUsed,
    timestamp: result.answer.timestamp
  });
}
