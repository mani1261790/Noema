import { promises as fs } from "fs";
import path from "path";
import { canonicalizeNotebookFile, notebookToHtml, type NotebookFile } from "./notebook-ingest";

export const NOTEBOOK_SOURCE_DIR = path.join(process.cwd(), "content", "notebooks");
export const NOTEBOOK_PUBLIC_DIR = path.join(process.cwd(), "public", "notebooks");
export const NOTEBOOK_HIGHLIGHT_PUBLIC_DIR = path.join(process.cwd(), "public", "highlight");
export const NOTEBOOK_KATEX_PUBLIC_DIR = path.join(process.cwd(), "public", "katex");
export const NOTEBOOK_CATALOG_SOURCE_PATH = path.join(process.cwd(), "content", "catalog.json");
export const NOTEBOOK_CATALOG_PUBLIC_PATH = path.join(process.cwd(), "public", "catalog.json");

export function notebookIdFromHtmlPath(htmlPath: string): string | null {
  const match = /^\/?notebooks\/([^/]+)\.html$/.exec(String(htmlPath).trim());
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function getPreferredNotebookSourceRelativePath(notebookId: string): string {
  const fileName = `${notebookId}.ipynb`;
  if (notebookId.startsWith("nma-compneuro-")) {
    return path.join("nma", "compneuro", fileName);
  }
  if (notebookId.startsWith("nma-dl-")) {
    return path.join("nma", "deep-learning", fileName);
  }
  return path.join("core", fileName);
}

async function walkNotebookSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkNotebookSourceFiles(entryPath);
      }
      return entry.isFile() && entry.name.endsWith(".ipynb") ? [entryPath] : [];
    })
  );
  return files.flat().sort();
}

export async function listNotebookSourceFiles(): Promise<string[]> {
  await fs.mkdir(NOTEBOOK_SOURCE_DIR, { recursive: true });
  return walkNotebookSourceFiles(NOTEBOOK_SOURCE_DIR);
}

export async function resolveNotebookSourcePath(notebookId: string): Promise<string> {
  const preferredPath = path.join(NOTEBOOK_SOURCE_DIR, getPreferredNotebookSourceRelativePath(notebookId));
  try {
    await fs.access(preferredPath);
    return preferredPath;
  } catch {
    const notebookFiles = await listNotebookSourceFiles();
    const directMatch = notebookFiles.find((filePath) => path.basename(filePath, ".ipynb") === notebookId);
    if (directMatch) return directMatch;
    throw new Error(`Notebook source not found for id: ${notebookId}`);
  }
}

export async function renderNotebookHtmlFragmentFromSource(notebookId: string): Promise<string> {
  const sourcePath = await resolveNotebookSourcePath(notebookId);
  const raw = await fs.readFile(sourcePath, "utf8");
  const notebook = JSON.parse(raw) as NotebookFile;
  return notebookToHtml(canonicalizeNotebookFile(notebook));
}
