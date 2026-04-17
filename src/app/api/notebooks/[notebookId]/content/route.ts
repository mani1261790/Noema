import { NextResponse } from "next/server";
import { getNotebookById, getNotebookHtml } from "@/lib/notebooks";

export async function GET(_: Request, { params }: { params: { notebookId: string } }) {
  const notebook = await getNotebookById(params.notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  try {
    const html = await getNotebookHtml(notebook.htmlPath);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=0, must-revalidate"
      }
    });
  } catch {
    return NextResponse.json({ error: "Notebook html not found" }, { status: 404 });
  }
}
