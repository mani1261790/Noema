import { promises as fs } from "fs";
import path from "path";
import {
  NOTEBOOK_CATALOG_SOURCE_PATH,
  NOTEBOOK_SOURCE_DIR,
  listNotebookSourceFiles,
  resolveNotebookSourcePath
} from "../src/lib/notebook-artifacts";

// Validates content/catalog.json before it ships. catalog.json is a large hand-edited file and
// a single mistake (bad JSON, duplicate id, htmlPath/id mismatch, missing .ipynb) breaks the
// whole site at runtime with no friendly error. This check turns those into clear PR-time
// failures so non-technical content authors get fast, specific feedback.

const NOTEBOOK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

type RawNotebook = {
  id?: unknown;
  title?: unknown;
  order?: unknown;
  htmlPath?: unknown;
  colabUrl?: unknown;
};

type RawChapter = {
  id?: unknown;
  title?: unknown;
  order?: unknown;
  notebooks?: unknown;
};

const errors: string[] = [];
const warnings: string[] = [];

function fail(message: string) {
  errors.push(message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function main() {
  let raw: string;
  try {
    raw = await fs.readFile(NOTEBOOK_CATALOG_SOURCE_PATH, "utf8");
  } catch (error) {
    console.error(`Cannot read catalog.json at ${NOTEBOOK_CATALOG_SOURCE_PATH}: ${String(error)}`);
    process.exit(1);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // The most common content-author break: a trailing comma or stray quote.
    console.error(`catalog.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
    return;
  }

  const chapters = (parsed as { chapters?: unknown })?.chapters;
  if (!Array.isArray(chapters)) {
    fail("catalog.json must have a top-level `chapters` array.");
    report();
    return;
  }

  const seenChapterIds = new Set<string>();
  const seenChapterOrders = new Set<number>();
  const seenNotebookIds = new Map<string, string>(); // notebookId -> chapterId (for global dup detection)
  const catalogNotebookIds = new Set<string>();

  for (const [chapterIndex, rawChapter] of (chapters as RawChapter[]).entries()) {
    const where = `chapters[${chapterIndex}]`;
    const chapterId = rawChapter?.id;
    if (!isNonEmptyString(chapterId)) {
      fail(`${where}: missing or empty chapter \`id\`.`);
      continue;
    }
    if (!NOTEBOOK_ID_PATTERN.test(chapterId)) {
      fail(`${where}: chapter id "${chapterId}" must be a lowercase slug (a-z, 0-9, hyphen).`);
    }
    if (seenChapterIds.has(chapterId)) {
      fail(`${where}: duplicate chapter id "${chapterId}".`);
    }
    seenChapterIds.add(chapterId);

    if (!isNonEmptyString(rawChapter?.title)) {
      fail(`chapter "${chapterId}": missing or empty \`title\`.`);
    }
    if (typeof rawChapter?.order !== "number") {
      fail(`chapter "${chapterId}": \`order\` must be a number.`);
    } else if (seenChapterOrders.has(rawChapter.order)) {
      fail(`chapter "${chapterId}": duplicate chapter \`order\` ${rawChapter.order}.`);
    } else {
      seenChapterOrders.add(rawChapter.order);
    }

    const notebooks = rawChapter?.notebooks;
    if (!Array.isArray(notebooks)) {
      fail(`chapter "${chapterId}": \`notebooks\` must be an array.`);
      continue;
    }

    const seenOrdersInChapter = new Set<number>();
    for (const [notebookIndex, rawNotebook] of (notebooks as RawNotebook[]).entries()) {
      const nbWhere = `chapter "${chapterId}" notebooks[${notebookIndex}]`;
      const notebookId = rawNotebook?.id;
      if (!isNonEmptyString(notebookId)) {
        fail(`${nbWhere}: missing or empty notebook \`id\`.`);
        continue;
      }
      if (!NOTEBOOK_ID_PATTERN.test(notebookId)) {
        fail(`${nbWhere}: notebook id "${notebookId}" must be a lowercase slug (a-z, 0-9, hyphen).`);
      }
      const priorChapter = seenNotebookIds.get(notebookId);
      if (priorChapter) {
        fail(`notebook id "${notebookId}" appears more than once (chapters "${priorChapter}" and "${chapterId}"). Ids must be globally unique.`);
      } else {
        seenNotebookIds.set(notebookId, chapterId);
      }
      catalogNotebookIds.add(notebookId);

      if (!isNonEmptyString(rawNotebook?.title)) {
        fail(`notebook "${notebookId}": missing or empty \`title\`.`);
      }
      if (typeof rawNotebook?.order !== "number") {
        fail(`notebook "${notebookId}": \`order\` must be a number.`);
      } else if (seenOrdersInChapter.has(rawNotebook.order)) {
        fail(`chapter "${chapterId}": duplicate notebook \`order\` ${rawNotebook.order} (id "${notebookId}").`);
      } else {
        seenOrdersInChapter.add(rawNotebook.order);
      }

      const expectedHtmlPath = `/notebooks/${notebookId}.html`;
      if (rawNotebook?.htmlPath !== expectedHtmlPath) {
        fail(`notebook "${notebookId}": htmlPath must be "${expectedHtmlPath}" but is ${JSON.stringify(rawNotebook?.htmlPath)}.`);
      }
      if (!isNonEmptyString(rawNotebook?.colabUrl)) {
        fail(`notebook "${notebookId}": missing or empty \`colabUrl\`.`);
      }

      // The catalog entry must point at a real notebook source file.
      try {
        await resolveNotebookSourcePath(notebookId);
      } catch {
        fail(`notebook "${notebookId}": no matching .ipynb found under content/notebooks/.`);
      }
    }
  }

  // Orphan source files under core/: notebooks authors added but forgot to wire into the
  // catalog. Non-fatal (a draft may legitimately precede its catalog entry), but surfaced so it
  // is not silently invisible. Limited to core/ because imported nma/ material intentionally
  // sits outside the public catalog and would otherwise bury the signal in noise.
  try {
    const sourceFiles = await listNotebookSourceFiles();
    for (const filePath of sourceFiles) {
      const id = path.basename(filePath, ".ipynb");
      if (catalogNotebookIds.has(id)) continue;
      const relFromRoot = path.relative(NOTEBOOK_SOURCE_DIR, filePath);
      if (!relFromRoot.split(path.sep).includes("core")) continue;
      warnings.push(`orphan notebook source not referenced by catalog.json: ${path.relative(process.cwd(), filePath)}`);
    }
  } catch {
    // listing is best-effort; ignore.
  }

  report();
}

function report() {
  for (const warning of warnings) {
    console.warn(`WARN  ${warning}`);
  }
  if (errors.length > 0) {
    console.error("");
    for (const error of errors) {
      console.error(`ERROR ${error}`);
    }
    console.error(`\ncatalog.json validation failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`catalog.json OK${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
