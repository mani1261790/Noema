import { promises as fs } from "fs";
import path from "path";
import sanitizeHtml from "sanitize-html";
import { prisma } from "@/lib/prisma";
import { loadNotebookHtml } from "@/lib/storage";

export type NotebookSummary = {
  id: string;
  title: string;
  order: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
  videoUrl?: string;
};

export type ChapterSummary = {
  id: string;
  title: string;
  order: number;
  notebooks: NotebookSummary[];
};

type Catalog = {
  chapters: ChapterSummary[];
};

const catalogPath = path.join(process.cwd(), "content", "catalog.json");

export async function getCatalog(): Promise<Catalog> {
  try {
    const rows = await prisma.notebook.findMany({ orderBy: [{ chapter: "asc" }, { sortOrder: "asc" }] });
    if (rows.length > 0) {
      const byChapter = new Map<string, ChapterSummary>();
      for (const row of rows) {
        const chapterId = row.chapter.toLowerCase().replace(/\s+/g, "-");
        const chapter = byChapter.get(chapterId) ?? {
          id: chapterId,
          title: row.chapter,
          order: byChapter.size + 1,
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
        byChapter.set(chapterId, chapter);
      }
      return { chapters: [...byChapter.values()] };
    }
  } catch {
    // Falls back to file catalog when db is not initialized.
  }

  const raw = await fs.readFile(catalogPath, "utf8");
  return JSON.parse(raw) as Catalog;
}

export async function getNotebookById(notebookId: string): Promise<NotebookSummary | null> {
  const catalog = await getCatalog();
  for (const chapter of catalog.chapters) {
    const notebook = chapter.notebooks.find((item) => item.id === notebookId);
    if (notebook) return notebook;
  }
  return null;
}

export async function getNotebookHtml(htmlPath: string): Promise<string> {
  const raw = await loadNotebookHtml(htmlPath);

  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["article", "h1", "h2", "h3", "pre", "code", "span"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class"],
      a: ["href", "target", "rel"]
    },
    allowedSchemes: ["http", "https", "mailto"]
  });
}
