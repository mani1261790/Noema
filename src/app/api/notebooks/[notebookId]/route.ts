import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getNotebookById, getNotebookHtml } from "@/lib/notebooks";

export async function GET(_: Request, { params }: { params: { notebookId: string } }) {
  const notebook = await getNotebookById(params.notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const [html, chunks] = await Promise.all([
    getNotebookHtml(notebook.htmlPath),
    prisma.notebookChunk
      .findMany({
        where: { notebookId: params.notebookId },
        orderBy: { position: "asc" },
        select: { sectionId: true }
      })
      .catch(() => [])
  ]);

  const sectionIds = Array.from(new Set(chunks.map((chunk) => chunk.sectionId))).filter(Boolean);

  return NextResponse.json({
    notebook,
    html,
    sectionIds
  });
}
