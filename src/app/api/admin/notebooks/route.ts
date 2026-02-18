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
import { getCatalog } from "@/lib/notebooks";
import { prisma } from "@/lib/prisma";
import { getRequestUser, isAdmin } from "@/lib/request-auth";
import { isS3Enabled, saveNotebookArtifacts } from "@/lib/storage";

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

type StructureChapterInput = {
  id?: string;
  title?: string;
  order?: number;
  notebooks?: Array<{
    id?: string;
    title?: string;
    order?: number;
  }>;
};

function toSafeTitle(value: unknown) {
  return String(value ?? "").trim();
}

async function writeCatalogFromRows(rows: Array<{
  id: string;
  title: string;
  chapter: string;
  sortOrder: number;
  tags: unknown;
  htmlPath: string;
  colabUrl: string;
  videoUrl: string | null;
}>, chapterTitlesInOrder?: string[]) {
  const chapterMap = new Map<
    string,
    {
      id: string;
      title: string;
      order: number;
      notebooks: Catalog["chapters"][number]["notebooks"];
    }
  >();

  const orderedTitles = chapterTitlesInOrder?.filter(Boolean) ?? [];
  orderedTitles.forEach((title, index) => {
    const chapterId = slugify(title) || `chapter-${index + 1}`;
    chapterMap.set(title, {
      id: chapterId,
      title,
      order: index + 1,
      notebooks: []
    });
  });

  for (const row of rows) {
    const chapterTitle = toSafeTitle(row.chapter) || "Uncategorized";
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
    chapters: [...chapterMap.values()]
      .sort((a, b) => a.order - b.order)
      .map((chapter) => ({
        ...chapter,
        notebooks: chapter.notebooks.slice().sort((a, b) => a.order - b.order)
      }))
  };

  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

async function updateCatalog(entry: {
  id: string;
  title: string;
  chapter: string;
  order: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
  videoUrl?: string;
}) {
  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;

  const chapterId = slugify(entry.chapter) || "chapter";
  let chapter = catalog.chapters.find((item) => item.id === chapterId);
  if (!chapter) {
    chapter = {
      id: chapterId,
      title: entry.chapter,
      order: catalog.chapters.length + 1,
      notebooks: []
    };
    catalog.chapters.push(chapter);
  }

  const existing = chapter.notebooks.findIndex((item) => item.id === entry.id);
  const payload = {
    id: entry.id,
    title: entry.title,
    order: entry.order,
    tags: entry.tags,
    htmlPath: entry.htmlPath,
    colabUrl: entry.colabUrl,
    videoUrl: entry.videoUrl
  };

  if (existing >= 0) {
    chapter.notebooks[existing] = payload;
  } else {
    chapter.notebooks.push(payload);
  }

  chapter.notebooks.sort((a, b) => a.order - b.order);
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8");
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const catalog = await getCatalog();
  return NextResponse.json({
    chapters: catalog.chapters
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        order: chapter.order,
        notebooks: chapter.notebooks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((notebook) => ({
            id: notebook.id,
            title: notebook.title,
            order: notebook.order,
            tags: notebook.tags,
            colabUrl: notebook.colabUrl,
            videoUrl: notebook.videoUrl,
            htmlPath: notebook.htmlPath
          }))
      }))
  });
}

export async function PATCH(request: Request) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { chapters?: StructureChapterInput[] } | null;
  const inputChapters = Array.isArray(body?.chapters) ? body.chapters : [];

  if (inputChapters.length === 0) {
    return NextResponse.json({ error: "chapters are required" }, { status: 400 });
  }

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
    }
  });

  const byId = new Map(rows.map((row) => [row.id, row]));

  const seenNotebookIds = new Set<string>();
  const seenChapterTitles = new Set<string>();
  const chapterTitlesInOrder: string[] = [];
  const updates: Array<{ id: string; title: string; chapter: string; sortOrder: number }> = [];
  let hasDuplicateNotebookId = false;
  let hasUnknownNotebookId = false;

  for (const chapter of inputChapters) {
    const chapterTitle = toSafeTitle(chapter.title);
    if (!chapterTitle) {
      return NextResponse.json({ error: "chapter title is required" }, { status: 400 });
    }
    if (seenChapterTitles.has(chapterTitle)) {
      return NextResponse.json({ error: `duplicate chapter title: ${chapterTitle}` }, { status: 400 });
    }

    seenChapterTitles.add(chapterTitle);
    chapterTitlesInOrder.push(chapterTitle);

    const notebooks = Array.isArray(chapter.notebooks) ? chapter.notebooks : [];
    notebooks.forEach((item, index) => {
      const notebookId = String(item.id ?? "").trim();
      if (!notebookId) return;
      if (seenNotebookIds.has(notebookId)) {
        hasDuplicateNotebookId = true;
        return;
      }
      if (!byId.has(notebookId)) {
        hasUnknownNotebookId = true;
        return;
      }
      seenNotebookIds.add(notebookId);

      const existing = byId.get(notebookId)!;
      updates.push({
        id: notebookId,
        title: toSafeTitle(item.title) || existing.title,
        chapter: chapterTitle,
        sortOrder: index + 1
      });
    });
  }

  if (hasDuplicateNotebookId || hasUnknownNotebookId) {
    return NextResponse.json(
      {
        error: hasDuplicateNotebookId
          ? "duplicate notebook id in payload"
          : "unknown notebook id in payload"
      },
      { status: 400 }
    );
  }

  if (seenNotebookIds.size !== rows.length) {
    const missing = rows.filter((row) => !seenNotebookIds.has(row.id)).map((row) => row.id);
    return NextResponse.json(
      {
        error: "payload does not include all notebooks",
        missingNotebookIds: missing
      },
      { status: 409 }
    );
  }

  await prisma.$transaction(
    updates.map((update) =>
      prisma.notebook.update({
        where: { id: update.id },
        data: {
          title: update.title,
          chapter: update.chapter,
          sortOrder: update.sortOrder
        }
      })
    )
  );

  if (!isS3Enabled()) {
    const reloaded = await prisma.notebook.findMany({
      select: {
        id: true,
        title: true,
        chapter: true,
        sortOrder: true,
        tags: true,
        htmlPath: true,
        colabUrl: true,
        videoUrl: true
      }
    });
    await writeCatalogFromRows(reloaded, chapterTitlesInOrder);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();

  const title = String(formData.get("title") ?? "").trim();
  const chapter = String(formData.get("chapter") ?? "").trim();
  const order = Number(formData.get("order") ?? 1);
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const colabUrl = String(formData.get("colabUrl") ?? "").trim();
  const videoUrl = String(formData.get("videoUrl") ?? "").trim() || undefined;
  const idFromForm = String(formData.get("id") ?? "").trim();
  const file = formData.get("file");

  if (!title || !chapter || !colabUrl || !(file instanceof File)) {
    return NextResponse.json({ error: "title/chapter/colabUrl/file are required" }, { status: 400 });
  }

  const notebookId = slugify(idFromForm || title);
  if (!notebookId) {
    return NextResponse.json({ error: "Invalid notebook id" }, { status: 400 });
  }

  const raw = await file.text();
  let notebookJson: NotebookFile;
  try {
    notebookJson = JSON.parse(raw) as NotebookFile;
  } catch {
    return NextResponse.json({ error: "Invalid ipynb format" }, { status: 400 });
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

  await prisma.notebook.upsert({
    where: { id: notebookId },
    update: {
      title,
      chapter,
      sortOrder: order,
      tags,
      htmlPath: stored.htmlPath,
      colabUrl,
      videoUrl: videoUrl ?? null
    },
    create: {
      id: notebookId,
      title,
      chapter,
      sortOrder: order,
      tags,
      htmlPath: stored.htmlPath,
      colabUrl,
      videoUrl: videoUrl ?? null
    }
  });

  await prisma.notebookChunk.deleteMany({ where: { notebookId } });
  if (chunks.length > 0) {
    await prisma.notebookChunk.createMany({
      data: chunks.map((chunk) => ({
        notebookId,
        sectionId: chunk.sectionId,
        content: chunk.content,
        position: chunk.position
      }))
    });
  }

  if (!isS3Enabled()) {
    await updateCatalog({
      id: notebookId,
      title,
      chapter,
      order,
      tags,
      htmlPath: stored.htmlPath,
      colabUrl,
      videoUrl
    });
  }

  return NextResponse.json({ notebookId }, { status: 201 });
}
