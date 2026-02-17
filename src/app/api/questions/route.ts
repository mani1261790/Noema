import { NextResponse } from "next/server";
import { enqueueQuestion, questionInputSchema } from "@/lib/qa";
import { getRequestUser } from "@/lib/request-auth";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const parsed = questionInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await enqueueQuestion(parsed.data, user.id);

    return NextResponse.json(
      {
        questionId: result.questionId,
        status: result.status,
        cached: result.cached
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue question";
    const status = message === "Notebook not found." ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
