import { promises as fs } from "fs";
import path from "path";
import sanitizeHtml from "sanitize-html";
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

async function readChapterOrderMap(): Promise<Map<string, number>> {
  try {
    const raw = await fs.readFile(catalogPath, "utf8");
    const parsed = JSON.parse(raw) as Catalog;
    const map = new Map<string, number>();
    for (const chapter of parsed.chapters || []) {
      if (!chapter?.title) continue;
      map.set(String(chapter.title), Number(chapter.order) || map.size + 1);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function getCatalog(): Promise<Catalog> {
  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  const chapterOrderMap = await readChapterOrderMap();

  return {
    chapters: (catalog.chapters ?? [])
      .map((chapter, index) => ({
        ...chapter,
        order: chapterOrderMap.get(chapter.title) ?? chapter.order ?? index + 1,
        notebooks: (chapter.notebooks ?? []).slice().sort((a, b) => a.order - b.order)
      }))
      .sort((a, b) => a.order - b.order)
  };
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
  const articleStart = raw.indexOf("<article");
  const articleEnd = raw.lastIndexOf("</article>");
  const candidate =
    articleStart >= 0 && articleEnd > articleStart ? raw.slice(articleStart, articleEnd + "</article>".length) : raw;

  const mathTags = [
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mo",
    "mn",
    "mfrac",
    "msup",
    "msub",
    "msubsup",
    "mover",
    "munder",
    "munderover",
    "msqrt",
    "mroot",
    "mstyle",
    "mspace",
    "mtext",
    "mtable",
    "mtr",
    "mtd",
    "mphantom",
    "mpadded"
  ];

  return sanitizeHtml(candidate, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["article", "iframe", "section", ...mathTags]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class", "id"],
      a: ["href", "target", "rel"],
      div: ["class", "id", "style", "aria-hidden"],
      section: ["class", "id", "style", "aria-hidden"],
      span: ["class", "id", "style", "aria-hidden"],
      iframe: [
        "src",
        "title",
        "loading",
        "referrerpolicy",
        "allow",
        "allowfullscreen",
        "style"
      ],
      math: ["xmlns", "display"],
      annotation: ["encoding"],
      mspace: ["width"],
      mpadded: ["height", "depth", "lspace", "voffset"],
      mo: ["stretchy"],
      mstyle: ["scriptlevel", "displaystyle"]
    },
    allowedSchemes: ["http", "https", "mailto"]
  });
}
