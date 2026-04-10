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

export async function renderNotebookHtmlFragmentFromSource(notebookId: string): Promise<string> {
  const sourcePath = path.join(NOTEBOOK_SOURCE_DIR, `${notebookId}.ipynb`);
  const raw = await fs.readFile(sourcePath, "utf8");
  const notebook = JSON.parse(raw) as NotebookFile;
  return notebookToHtml(canonicalizeNotebookFile(notebook));
}
