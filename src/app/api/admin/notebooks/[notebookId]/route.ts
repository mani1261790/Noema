import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import {
  canonicalizeNotebookFile,
  extractChunks,
  notebookToHtml,
  slugify,
  type NotebookFile
} from "@/lib/notebook-ingest";
import { prisma } from "@/lib/prisma";
import { getRequestUser, isAdmin } from "@/lib/request-auth";
import { isS3Enabled, loadNotebookIpynb, saveNotebookArtifacts } from "@/lib/storage";

type Catalog = {
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    notebooks: Array<{
      id: string;
      title: string;
      order: number;
      tags: string[];
      htmlPath: string;
      colabUrl: string;
      videoUrl?: string;
    }>;
  }>;
};

const catalogPath = path.join(process.cwd(), "content", "catalog.json");

async function rewriteCatalogFromDb() {
  const rows = await prisma.notebook.findMany({
    select: {
      id: true,
      title: true,
      chapter: true,
      sortOrder: true,
      tags: true,
      htmlPath: true,
      colabUrl: true,
      videoUrl: true
    },
    orderBy: [{ chapter: "asc" }, { sortOrder: "asc" }]
  });

  const chapterMap = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      notebooks: Catalog["chapters"][number]["notebooks"];
    }
  >();

  for (const row of rows) {
    const chapterTitle = String(row.chapter || "").trim() || "Uncategorized";
    const chapterId = slugify(chapterTitle) || `chapter-${chapterMap.size + 1}`;
    const chapter = chapterMap.get(chapterTitle) ?? {
      id: chapterId,
      title: chapterTitle,
      order: chapterMap.size + 1,
      notebooks: []
    };

    chapter.notebooks.push({
      id: row.id,
      title: row.title,
      order: row.sortOrder,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      htmlPath: row.htmlPath,
      colabUrl: row.colabUrl,
      videoUrl: row.videoUrl ?? undefined
    });

    chapterMap.set(chapterTitle, chapter);
  }

  const catalog: Catalog = {
    chapters: [...chapterMap.values()].map((chapter) => ({
      ...chapter,
      notebooks: chapter.notebooks.slice().sort((a, b) => a.order - b.order)
    }))
  };

  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

export async function GET(request: Request, { params }: { params: { notebookId: string } }) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const notebookId = String(params.notebookId || "").trim();
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  }

  const notebook = await prisma.notebook.findUnique({
    where: { id: notebookId },
    select: {
      id: true,
      title: true,
      chapter: true,
      sortOrder: true,
      tags: true,
      htmlPath: true,
      colabUrl: true,
      videoUrl: true,
      updatedAt: true
    }
  });

  if (!notebook) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  let ipynbRaw = "";
  try {
    ipynbRaw = await loadNotebookIpynb(notebookId);
  } catch {
    ipynbRaw = "";
  }

  return NextResponse.json({
    notebook: {
      ...notebook,
      tags: Array.isArray(notebook.tags) ? (notebook.tags as string[]) : [],
      updatedAt: notebook.updatedAt.toISOString()
    },
    ipynbRaw
  });
}

export async function PUT(request: Request, { params }: { params: { notebookId: string } }) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const notebookId = String(params.notebookId || "").trim();
  if (!notebookId) {
    return NextResponse.json({ error: "notebookId is required" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        title?: string;
        chapter?: string;
        sortOrder?: number;
        tags?: string[];
        colabUrl?: string;
        videoUrl?: string | null;
        ipynbRaw?: string;
      }
    | null;

  const current = await prisma.notebook.findUnique({ where: { id: notebookId } });
  if (!current) {
    return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  }

  const title = String(body?.title ?? current.title).trim() || current.title;
  const chapter = String(body?.chapter ?? current.chapter).trim() || current.chapter;
  const sortOrderRaw = Number(body?.sortOrder ?? current.sortOrder);
  const sortOrder = Number.isFinite(sortOrderRaw) && sortOrderRaw >= 1 ? Math.floor(sortOrderRaw) : current.sortOrder;
  const tags = Array.isArray(body?.tags)
    ? body!.tags.map((value) => String(value).trim()).filter(Boolean)
    : Array.isArray(current.tags)
      ? (current.tags as string[])
      : [];
  const colabUrl = String(body?.colabUrl ?? current.colabUrl).trim() || current.colabUrl;
  const videoUrl = typeof body?.videoUrl === "string" ? body.videoUrl.trim() || null : current.videoUrl;

  const ipynbRaw = typeof body?.ipynbRaw === "string" ? body.ipynbRaw : null;

  if (ipynbRaw !== null) {
    let notebookJson: NotebookFile;
    try {
      notebookJson = JSON.parse(ipynbRaw) as NotebookFile;
    } catch {
      return NextResponse.json({ error: "Invalid ipynb JSON" }, { status: 400 });
    }

    const canonicalNotebook = canonicalizeNotebookFile(notebookJson);
    const canonicalRaw = `${JSON.stringify(canonicalNotebook, null, 2)}\n`;
    const html = notebookToHtml(canonicalNotebook);
    const chunks = extractChunks(canonicalNotebook);

    const stored = await saveNotebookArtifacts({
      notebookId,
      ipynbRaw: canonicalRaw,
      html
    });

    await prisma.$transaction([
      prisma.notebook.update({
        where: { id: notebookId },
        data: {
          title,
          chapter,
          sortOrder,
          tags,
          colabUrl,
          videoUrl,
          htmlPath: stored.htmlPath
        }
      }),
      prisma.notebookChunk.deleteMany({ where: { notebookId } }),
      ...(chunks.length
        ? [
            prisma.notebookChunk.createMany({
              data: chunks.map((chunk) => ({
                notebookId,
                sectionId: chunk.sectionId,
                content: chunk.content,
                position: chunk.position
              }))
            })
          ]
        : [])
    ]);
  } else {
    await prisma.notebook.update({
      where: { id: notebookId },
      data: {
        title,
        chapter,
        sortOrder,
        tags,
        colabUrl,
        videoUrl
      }
    });
  }

  if (!isS3Enabled()) {
    await rewriteCatalogFromDb();
  }

  return NextResponse.json({ ok: true });
}
