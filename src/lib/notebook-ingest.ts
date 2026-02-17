import MarkdownIt from "markdown-it";
import markdownItKatex from "markdown-it-katex";

export type NotebookCell = {
  cell_type: "markdown" | "code";
  source?: string[] | string;
};

export type NotebookFile = {
  cells?: NotebookCell[];
};

export function slugify(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (base) return base;

  const digest = Buffer.from(value, "utf8").toString("hex").slice(0, 12);
  return `section-${digest}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeMarkdownText(value: string): string {
  const hasRealNewline = value.includes("\n");
  if (hasRealNewline) return value;
  return value.replace(/(?<!\\)\\r\\n/g, "\n").replace(/(?<!\\)\\n/g, "\n");
}

function normalizeCodeText(value: string): string {
  const hasRealNewline = value.includes("\n");
  if (hasRealNewline) return value;

  let out = "";
  let i = 0;
  let quote: "'" | '"' | null = null;
  let triple = false;

  while (i < value.length) {
    const ch = value[i];

    if (!quote) {
      if (ch === "'" || ch === '"') {
        const isTriple = value[i + 1] === ch && value[i + 2] === ch;
        quote = ch;
        triple = isTriple;
        if (isTriple) {
          out += ch.repeat(3);
          i += 3;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }

      if (ch === "\\" && value[i + 1] === "r" && value[i + 2] === "\\" && value[i + 3] === "n") {
        out += "\n";
        i += 4;
        continue;
      }
      if (ch === "\\" && value[i + 1] === "n") {
        out += "\n";
        i += 2;
        continue;
      }
      if (ch === "\\" && value[i + 1] === "t") {
        out += "\t";
        i += 2;
        continue;
      }

      out += ch;
      i += 1;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      if (i + 1 < value.length) {
        out += value[i + 1];
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (triple && ch === quote && value[i + 1] === quote && value[i + 2] === quote) {
      out += ch.repeat(3);
      quote = null;
      triple = false;
      i += 3;
      continue;
    }

    if (!triple && ch === quote) {
      out += ch;
      quote = null;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function sourceToText(source: NotebookCell["source"]): string {
  if (Array.isArray(source)) {
    return source.map((line) => String(line)).join("");
  }
  if (typeof source === "string") {
    return source;
  }
  return "";
}

function normalizeCellSource(cell: NotebookCell): string {
  const text = sourceToText(cell.source);
  if (cell.cell_type === "markdown") {
    return normalizeMarkdownText(text);
  }
  return normalizeCodeText(text);
}

export function canonicalizeNotebookFile<T extends { cells?: Array<{ cell_type?: unknown; source?: unknown }> }>(input: T): T {
  if (!Array.isArray(input.cells)) {
    return input;
  }

  const normalizedCells = input.cells.map((cellLike) => {
    const cell = cellLike as NotebookCell;
    if (!cell || (cell.cell_type !== "markdown" && cell.cell_type !== "code")) {
      return cellLike;
    }
    const normalizedSource = normalizeCellSource(cell);
    return {
      ...cellLike,
      source: [normalizedSource]
    };
  });

  return {
    ...input,
    cells: normalizedCells
  };
}

const markdownRenderer = (() => {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: true
  });

  md.use(markdownItKatex);

  const fallbackHeadingOpen = md.renderer.rules.heading_open;
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const inlineToken = tokens[idx + 1];
    const headingText = inlineToken && inlineToken.type === "inline" ? inlineToken.content : "";
    const id = slugify(headingText);
    if (id) {
      tokens[idx].attrSet("id", id);
    }
    if (fallbackHeadingOpen) {
      return fallbackHeadingOpen(tokens, idx, options, env, self);
    }
    return self.renderToken(tokens, idx, options);
  };

  return md;
})();

export function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = normalizeCellSource(cell).trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      pieces.push(markdownRenderer.render(text));
      continue;
    }

    pieces.push(`<pre><code class="language-python">${escapeHtml(text)}</code></pre>`);
  }

  pieces.push("</article>");
  return pieces.join("\n");
}

export function extractChunks(input: NotebookFile) {
  const chunks: Array<{ sectionId: string; content: string; position: number }> = [];
  let sectionId = "intro";
  let position = 0;

  for (const cell of input.cells ?? []) {
    const raw = normalizeCellSource(cell).trim();
    if (!raw) continue;

    if (cell.cell_type === "markdown") {
      const heading = raw
        .split("\n")
        .map((line) => line.trim())
        .find((line) => /^#{1,3}\s+/.test(line));
      if (heading) {
        sectionId = slugify(heading.replace(/^#{1,3}\s+/, "")) || sectionId;
      }
    }

    chunks.push({
      sectionId,
      content: raw.replace(/\s+/g, " ").trim(),
      position: position++
    });
  }

  return chunks;
}
