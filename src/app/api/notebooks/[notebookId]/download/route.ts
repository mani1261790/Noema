import { NextResponse } from "next/server";
import { getNotebookById } from "@/lib/notebooks";
import { loadNotebookIpynb } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: { notebookId: string } }) {
  const notebook = await getNotebookById(params.notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  try {
    const content = await loadNotebookIpynb(params.notebookId);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ipynb+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${params.notebookId}.ipynb"`,
        "Cache-Control": "private, max-age=0, must-revalidate"
      }
    });
  } catch {
    return NextResponse.json({ error: "ipynb not found" }, { status: 404 });
  }
}
