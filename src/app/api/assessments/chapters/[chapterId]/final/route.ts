import { NextResponse } from "next/server";
import { getChapterFinalAssessment } from "@/lib/assessments";

type RouteContext = {
  params: {
    chapterId: string;
  };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const assessment = await getChapterFinalAssessment(params.chapterId);
  if (!assessment) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
  return NextResponse.json(assessment);
}
