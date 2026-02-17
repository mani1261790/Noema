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
