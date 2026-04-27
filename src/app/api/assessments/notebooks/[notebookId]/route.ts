import { NextResponse } from "next/server";
import { getPublicNotebookCheckAssessment } from "@/lib/assessments";

type RouteContext = {
  params: {
    notebookId: string;
  };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const assessment = await getPublicNotebookCheckAssessment(params.notebookId);
  if (!assessment) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
  return NextResponse.json(assessment);
}
