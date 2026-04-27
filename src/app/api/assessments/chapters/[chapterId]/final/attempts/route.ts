import { NextResponse } from "next/server";
import {
  CHAPTER_FINAL_REQUEST_BODY_MAX_CHARS,
  getChapterFinalAssessment,
  gradeChapterFinalWithLlm,
  sanitizeChapterFinalAnswers,
  validateChapterFinalAnswers
} from "@/lib/assessments";

type RouteContext = {
  params: {
    chapterId: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  const assessment = await getChapterFinalAssessment(params.chapterId);
  if (!assessment) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (rawBody.length > CHAPTER_FINAL_REQUEST_BODY_MAX_CHARS) {
    return NextResponse.json(
      { error: `Request body exceeds ${CHAPTER_FINAL_REQUEST_BODY_MAX_CHARS} characters` },
      { status: 413 }
    );
  }

  let payload: { answers?: Record<string, unknown>; provider?: "openai" | "gemini"; modelId?: string; apiKey?: string } = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validation = validateChapterFinalAnswers(payload.answers || {});
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const result = await gradeChapterFinalWithLlm(assessment, sanitizeChapterFinalAnswers(payload.answers || {}), {
    provider: payload.provider,
    modelId: payload.modelId,
    apiKey: payload.apiKey
  });
  return NextResponse.json(result);
}
