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

function normalizeMathDelimiters(value: string): string {
  return value
    .replace(/\\\[((?:[\s\S]*?))\\\]/g, (_, expr: string) => `$$\n${expr.trim()}\n$$`)
    .replace(/\\\(((?:[\s\S]*?))\\\)/g, (_, expr: string) => `$${expr.trim()}$`);
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
  type HeadingOpenRule = NonNullable<typeof fallbackHeadingOpen>;
  const headingOpenRule: HeadingOpenRule = (tokens, idx, options, env, self) => {
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
  md.renderer.rules.heading_open = headingOpenRule;

  return md;
})();

const YOUTUBE_DIRECTIVE_RE = /^\s*@\[(?:youtube|yt)\]\((https?:\/\/[^\s)]+)\)\s*$/im;
const YOUTUBE_DIRECTIVE_GLOBAL_RE = /^\s*@\[(?:youtube|yt)\]\((https?:\/\/[^\s)]+)\)\s*$/gim;

function extractYouTubeDirectiveUrl(markdownText: string): string | null {
  const match = markdownText.match(YOUTUBE_DIRECTIVE_RE);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

function stripYouTubeDirective(markdownText: string): string {
  return markdownText.replace(YOUTUBE_DIRECTIVE_GLOBAL_RE, "").trim();
}

function toYouTubeEmbedUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const isYouTubeHost =
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be";
  if (!isYouTubeHost) return null;

  let videoId = "";
  if (host === "youtu.be") {
    videoId = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else if (parsed.pathname === "/watch") {
    videoId = (parsed.searchParams.get("v") || "").trim();
  } else if (parsed.pathname.startsWith("/embed/") || parsed.pathname.startsWith("/shorts/")) {
    videoId = parsed.pathname.split("/")[2] || "";
  }

  if (videoId && /^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  const listId = (parsed.searchParams.get("list") || "").trim();
  if (listId && /^[A-Za-z0-9_-]{8,64}$/.test(listId)) {
    return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(listId)}`;
  }

  return null;
}

function buildYouTubeEmbedHtml(markdownText: string): string {
  const directiveUrl = extractYouTubeDirectiveUrl(markdownText);
  if (!directiveUrl) return "";
  const embedUrl = toYouTubeEmbedUrl(directiveUrl);
  if (!embedUrl) return "";
  return [
    '<section class="yt-embed" style="margin:.9rem 0 1.2rem;">',
    '<div style="position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;border:1px solid rgba(138,159,194,.36);background:#0a1322;">',
    `<iframe src="${embedUrl}" title="YouTube lecture reference" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe>`,
    "</div>",
    "</section>"
  ].join("");
}

export function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = normalizeCellSource(cell).trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      const normalizedMarkdown = normalizeMathDelimiters(text);
      const visibleMarkdown = stripYouTubeDirective(normalizedMarkdown);
      if (visibleMarkdown) {
        pieces.push(markdownRenderer.render(visibleMarkdown));
      }
      const youtubeEmbedHtml = buildYouTubeEmbedHtml(normalizedMarkdown);
      if (youtubeEmbedHtml) {
        pieces.push(youtubeEmbedHtml);
      }
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
