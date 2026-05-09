import { promises as fs } from "fs";
import path from "path";

type Catalog = {
  chapters: Array<{
    id: string;
    title: string;
    notebooks: Array<{
      id: string;
      title: string;
    }>;
  }>;
};

const ASSESSMENT_CHAPTER_IDS = new Set([
  "python",
  "machine-learning",
  "deep-learning",
  "reinforcement-learning",
  "llm",
  "deep-generative-models",
  "world-models"
]);

const rootDir = process.cwd();
const catalogPath = path.join(rootDir, "content", "catalog.json");
const notebookChecksDir = path.join(rootDir, "content", "assessments", "notebook-checks");
const chapterFinalsDir = path.join(rootDir, "content", "assessments", "chapter-finals");

async function listJsonBaseNames(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return new Set(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.basename(entry.name, ".json"))
  );
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function main() {
  const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8")) as Catalog;
  const notebookChecks = await listJsonBaseNames(notebookChecksDir);
  const chapterFinals = await listJsonBaseNames(chapterFinalsDir);

  const expectedNotebookChecks = new Set<string>();
  const expectedChapterFinals = new Set<string>();
  const failures: string[] = [];

  for (const chapter of catalog.chapters) {
    if (!ASSESSMENT_CHAPTER_IDS.has(chapter.id)) continue;

    expectedChapterFinals.add(chapter.id);
    if (!chapterFinals.has(chapter.id)) {
      failures.push(`Missing chapter final: ${chapter.id}`);
    } else {
      const filePath = path.join(chapterFinalsDir, `${chapter.id}.json`);
      const parsed = await readJson(filePath);
      if (!parsed) {
        failures.push(`Invalid chapter final JSON: ${chapter.id}`);
      } else {
        if (String(parsed.chapterId || "").trim() !== chapter.id) {
          failures.push(`Chapter final chapterId mismatch: ${chapter.id}`);
        }
        const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        if (questions.length < 1) {
          failures.push(`Chapter final has no questions: ${chapter.id}`);
        }
      }
    }

    for (const notebook of chapter.notebooks) {
      expectedNotebookChecks.add(notebook.id);
      if (!notebookChecks.has(notebook.id)) {
        failures.push(`Missing notebook check: ${chapter.id}/${notebook.id}`);
      } else {
        const filePath = path.join(notebookChecksDir, `${notebook.id}.json`);
        const parsed = await readJson(filePath);
        if (!parsed) {
          failures.push(`Invalid notebook check JSON: ${notebook.id}`);
        } else {
          if (String(parsed.notebookId || "").trim() !== notebook.id) {
            failures.push(`Notebook check notebookId mismatch: ${notebook.id}`);
          }
          const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
          if (questions.length !== 5) {
            failures.push(`Notebook check must contain exactly 5 questions: ${notebook.id}`);
          }
        }
      }
    }
  }

  for (const notebookId of notebookChecks) {
    if (!expectedNotebookChecks.has(notebookId)) {
      failures.push(`Orphan notebook check file: ${notebookId}`);
    }
  }

  for (const chapterId of chapterFinals) {
    if (!expectedChapterFinals.has(chapterId)) {
      failures.push(`Orphan chapter final file: ${chapterId}`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    process.exit(1);
  }

  console.log(
    `Assessment integrity OK: ${expectedNotebookChecks.size} notebook checks, ${expectedChapterFinals.size} chapter finals.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
