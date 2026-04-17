import { promises as fs } from "fs";
import path from "path";
import { canonicalizeNotebookFile, notebookToHtml, type NotebookFile } from "./notebook-ingest";

export const NOTEBOOK_SOURCE_DIR = path.join(process.cwd(), "content", "notebooks");
export const NOTEBOOK_PUBLIC_DIR = path.join(process.cwd(), "public", "notebooks");
export const NOTEBOOK_HIGHLIGHT_PUBLIC_DIR = path.join(process.cwd(), "public", "highlight");
export const NOTEBOOK_KATEX_PUBLIC_DIR = path.join(process.cwd(), "public", "katex");
export const NOTEBOOK_CATALOG_SOURCE_PATH = path.join(process.cwd(), "content", "catalog.json");

const CORE_NOTEBOOK_SECTION_BY_ID: Record<string, string> = {
  "python-basic-operations": "python",
  "numpy-basics": "python",
  "pandas-basics": "python",
  "matplotlib-seaborn": "python",
  "simple-regression": "machine-learning",
  "multiple-regression": "machine-learning",
  "sklearn-xgboost": "machine-learning",
  "feature-engineering": "machine-learning",
  "supervised-unsupervised-learning": "machine-learning",
  "time-series-data": "machine-learning",
  "sql-for-ml": "machine-learning",
  "neural-network-basics": "deep-learning",
  "loss-and-gradient-descent": "deep-learning",
  "optimization-regularization": "deep-learning",
  "convolution-basics": "deep-learning",
  "image-recognition-yolo": "deep-learning",
  "recurrent-neural-networks": "deep-learning",
  "transformer-basics": "deep-learning",
  "nlp-deep-learning": "deep-learning",
  "rl-foundation": "reinforcement-learning",
  "bellman-equations": "reinforcement-learning",
  "td-learning": "reinforcement-learning",
  "q-learning": "reinforcement-learning",
  "sarsa": "reinforcement-learning",
  "n-step-td": "reinforcement-learning",
  "td-lambda": "reinforcement-learning",
  "eligibility-trace-td-lambda": "reinforcement-learning",
  "deep-rl": "reinforcement-learning",
  "reinforcement-learning-overview": "reinforcement-learning",
  "prompt-engineering": "llm",
  "llm-pretraining": "llm",
  "scaling-laws": "llm",
  "fine-tuning": "llm",
  "hallucination-rlhf": "llm",
  "tool-use-rag": "llm",
  "llm-efficiency": "llm",
  "generative-model-overview": "deep-generative-models",
  "latent-variable-mixture-models": "deep-generative-models",
  "vae": "deep-generative-models",
  "gan": "deep-generative-models",
  "autoregressive-flow-models": "deep-generative-models",
  "energy-based-models": "deep-generative-models",
  "score-diffusion-models": "deep-generative-models",
  "continuous-diffusion-flow-matching": "deep-generative-models",
  "world-models-and-generative-models": "world-models",
  "control-model-and-mbrl": "world-models",
  "state-space-models": "world-models",
  "state-representation-learning": "world-models",
  "state-prediction-models": "world-models",
  "vae-diffusion-world-models": "world-models",
  "simulation-and-cg": "world-models",
  "ssm-and-transformer": "world-models",
  "observation-prediction-models": "world-models",
  "multimodal-world-models": "world-models"
};

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
  const coreSection = CORE_NOTEBOOK_SECTION_BY_ID[notebookId];
  return coreSection ? path.join("core", coreSection, fileName) : path.join("core", fileName);
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
