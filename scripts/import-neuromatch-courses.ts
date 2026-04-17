import { promises as fs } from "fs";
import path from "path";
import { canonicalizeNotebookFile, type NotebookFile } from "../src/lib/notebook-ingest";

type SourceKind = "noema-original" | "open-license-translation";

type NotebookSource = {
  kind: SourceKind;
  provider: string;
  license: string;
  originalTitle?: string;
  originalUrl?: string;
  translationLanguage?: string;
};

type CatalogNotebook = {
  id: string;
  title: string;
  order: number;
  tags: string[];
  htmlPath: string;
  colabUrl: string;
  videoUrl?: string;
  source?: NotebookSource;
};

type CatalogChapter = {
  id: string;
  title: string;
  audience?: "beginner" | "advanced";
  order: number;
  notebooks: CatalogNotebook[];
};

type Catalog = {
  contentSourceDefaults?: NotebookSource;
  chapters: CatalogChapter[];
};

type CourseConfig = {
  key: "compneuro" | "dl";
  sourceRoot: string;
  chapterId: string;
  chapterTitle: string;
  chapterOrder: number;
  audience: "advanced";
  idPrefix: string;
  sourceUrl: string;
};

const COURSE_CONFIGS: CourseConfig[] = [
  {
    key: "compneuro",
    sourceRoot: "/tmp/neuromatch-course-content",
    chapterId: "neuromatch-compneuro",
    chapterTitle: "Neuromatch Academy / Computational Neuroscience",
    chapterOrder: 100,
    audience: "advanced",
    idPrefix: "nma-compneuro",
    sourceUrl: "https://github.com/NeuromatchAcademy/course-content"
  },
  {
    key: "dl",
    sourceRoot: "/tmp/neuromatch-course-content-dl",
    chapterId: "neuromatch-dl",
    chapterTitle: "Neuromatch Academy / Deep Learning",
    chapterOrder: 101,
    audience: "advanced",
    idPrefix: "nma-dl",
    sourceUrl: "https://github.com/NeuromatchAcademy/course-content-dl"
  }
];

function getArg(flag: string): string | null {
  const index = process.argv.findIndex((arg) => arg === flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function sourceToText(source: unknown): string {
  if (Array.isArray(source)) return source.map((item) => String(item)).join("");
  if (typeof source === "string") return source;
  return "";
}

function firstHeadingFromNotebook(notebook: NotebookFile): string {
  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  for (const cell of cells) {
    if (!cell || cell.cell_type !== "markdown") continue;
    const text = sourceToText(cell.source);
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^#\s+(.+?)\s*$/);
      if (match) return match[1].trim();
    }
  }
  return "";
}

function normalizeNotebookTitle(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  return text.replace(/\s+#?\s*$/g, "").trim();
}

async function walkStudentNotebooks(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(next);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!next.endsWith(".ipynb")) continue;
      if (!next.includes(`${path.sep}student${path.sep}`)) continue;
      found.push(next);
    }
  }

  await walk(path.join(root, "tutorials"));
  return found.sort();
}

async function translateMarkdownCellsWithOpenAi(cells: string[], apiKey: string, model: string): Promise<string[]> {
  if (!cells.length) return cells;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You translate educational notebook markdown from English to natural Japanese. Preserve markdown, code fences, links, math, HTML, and structure. Do not translate code identifiers unless they are prose. Return only valid JSON in the form {\"translations\":[...]} with the exact same number of items as the input."
        },
        {
          role: "user",
          content: JSON.stringify({ cells })
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI translation failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  let out = String(payload.choices?.[0]?.message?.content || "").trim();
  if (!out) {
    throw new Error("OpenAI translation returned empty content");
  }
  out = out.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: { translations?: unknown } = {};
  try {
    parsed = JSON.parse(out) as { translations?: unknown };
  } catch {
    throw new Error("OpenAI translation returned non-JSON content");
  }
  const translations = Array.isArray(parsed.translations) ? parsed.translations.map((item) => String(item ?? "")) : [];
  if (translations.length !== cells.length) {
    throw new Error(`OpenAI translation returned ${translations.length} items for ${cells.length} cells`);
  }
  return translations;
}

async function translateMarkdownCellsWithFallback(cells: string[], apiKey: string, model: string): Promise<string[]> {
  if (cells.length <= 1) {
    return translateMarkdownCellsWithOpenAi(cells, apiKey, model);
  }

  try {
    return await translateMarkdownCellsWithOpenAi(cells, apiKey, model);
  } catch (error) {
    const midpoint = Math.ceil(cells.length / 2);
    const left = await translateMarkdownCellsWithFallback(cells.slice(0, midpoint), apiKey, model);
    const right = await translateMarkdownCellsWithFallback(cells.slice(midpoint), apiKey, model);
    return left.concat(right);
  }
}

async function maybeTranslateNotebook(notebook: NotebookFile, apiKey: string | null, model: string): Promise<NotebookFile> {
  if (!apiKey) return notebook;
  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  const markdownIndexes: number[] = [];
  const markdownTexts: string[] = [];

  cells.forEach((cell, index) => {
    if (!cell || cell.cell_type !== "markdown") return;
    markdownIndexes.push(index);
    markdownTexts.push(sourceToText(cell.source));
  });

  const translatedTexts = await translateMarkdownCellsWithFallback(markdownTexts, apiKey, model);
  const translatedCells = cells.slice();
  markdownIndexes.forEach((cellIndex, translatedIndex) => {
    const cell = translatedCells[cellIndex];
    if (!cell) return;
    translatedCells[cellIndex] = {
      ...cell,
      source: [translatedTexts[translatedIndex]]
    };
  });

  return {
    ...notebook,
    cells: translatedCells
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const width = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: width }, () => runner()));
  return results;
}

async function main() {
  const catalogPath = path.join(process.cwd(), "content", "catalog.json");
  const notebookDir = path.join(process.cwd(), "content", "notebooks");
  const rawCatalog = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(rawCatalog) as Catalog;
  const apiKey = getArg("--openai-api-key") || process.env.OPENAI_API_KEY || null;
  const model = getArg("--openai-model") || "gpt-4.1-mini";
  const translate = hasFlag("--translate");
  const concurrencyRaw = Number(getArg("--concurrency") || "4");
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 4;

  await fs.mkdir(notebookDir, { recursive: true });

  let nextCatalog = {
    ...catalog,
    chapters: (catalog.chapters || []).filter(
      (chapter) => !COURSE_CONFIGS.some((config) => config.chapterId === chapter.id)
    )
  } as Catalog;

  for (const config of COURSE_CONFIGS) {
    const notebookPaths = await walkStudentNotebooks(config.sourceRoot);
    const notebooks = await mapWithConcurrency(notebookPaths, concurrency, async (notebookPath, index) => {
      console.log(`[${config.key}] importing ${path.basename(path.dirname(path.dirname(notebookPath)))}/${path.basename(notebookPath)}`);
      const raw = await fs.readFile(notebookPath, "utf8");
      const parsed = JSON.parse(raw) as NotebookFile;
      const canonical = canonicalizeNotebookFile(parsed);
      const translated = translate ? await maybeTranslateNotebook(canonical, apiKey, model) : canonical;
      const heading = normalizeNotebookTitle(firstHeadingFromNotebook(translated));
      const relative = path.relative(config.sourceRoot, notebookPath).replace(/\\/g, "/");
      const stem = path.basename(notebookPath, ".ipynb");
      const parent = path.basename(path.dirname(path.dirname(notebookPath)));
      const notebookId = `${config.idPrefix}-${toSlug(parent)}-${toSlug(stem)}`;
      const title = heading || `${parent} ${stem}`;
      const outputPath = path.join(notebookDir, `${notebookId}.ipynb`);
      const outputRaw = `${JSON.stringify(translated, null, 2)}\n`;
      await fs.writeFile(outputPath, outputRaw, "utf8");
      console.log(`[${config.key}] wrote ${notebookId}`);

      return {
        id: notebookId,
        title,
        order: index + 1,
        tags: ["neuromatch", config.key, "translation"],
        htmlPath: `/notebooks/${notebookId}.html`,
        colabUrl: `https://colab.research.google.com/github/NeuromatchAcademy/${config.key === "compneuro" ? "course-content" : "course-content-dl"}/blob/main/${relative}`,
        source: {
          kind: "open-license-translation" as const,
          provider: "Neuromatch Academy",
          license: "CC BY 4.0 / BSD-3-Clause (code)",
          originalTitle: normalizeNotebookTitle(firstHeadingFromNotebook(canonical)) || title,
          originalUrl: `${config.sourceUrl}/blob/main/${relative}`,
          translationLanguage: translate ? "日本語" : "English"
        }
      };
    });

    nextCatalog.chapters.push({
      id: config.chapterId,
      title: config.chapterTitle,
      audience: config.audience,
      order: config.chapterOrder,
      notebooks
    });
  }

  nextCatalog = {
    ...nextCatalog,
    chapters: nextCatalog.chapters.sort((a, b) => a.order - b.order)
  };

  await fs.writeFile(catalogPath, `${JSON.stringify(nextCatalog, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
