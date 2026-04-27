import { NextResponse } from "next/server";
import { getNotebookCheckAssessment, gradeNotebookCheck } from "@/lib/assessments";

type RouteContext = {
  params: {
    notebookId: string;
  };
};

export async function POST(request: Request, { params }: RouteContext) {
  const assessment = await getNotebookCheckAssessment(params.notebookId);
  if (!assessment) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  let payload: { answers?: Record<string, string> } = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = gradeNotebookCheck(assessment, payload.answers || {});
  return NextResponse.json(result);
}
