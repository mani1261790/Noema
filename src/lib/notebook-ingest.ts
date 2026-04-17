import MarkdownIt from "markdown-it";
import katex from "katex";

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

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function normalizeMarkdownText(value: string): string {
  const hasRealNewline = value.includes("\n");
  if (hasRealNewline) return value;
  return value.replace(/(?<!\\)\\r\\n/g, "\n").replace(/(?<!\\)\\n/g, "\n");
}

function shouldRenderBracketedMathInline(expr: string, source: string, offset: number, matchLength: number): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (/\\\\|\\begin\{|\\end\{/.test(trimmed)) return false;

  const before = source.slice(0, offset);
  const after = source.slice(offset + matchLength);
  const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
  const nextNewlineIndex = after.indexOf("\n");
  const lineAfter = nextNewlineIndex >= 0 ? after.slice(0, nextNewlineIndex) : after;

  // Treat \[...\] as display math when it occupies its own line.
  if (!lineBefore.trim() && !lineAfter.trim()) return false;

  return true;
}

function normalizeMathDelimiters(value: string): string {
  return value
    .replace(/\\\[((?:[\s\S]*?))\\\]/g, (match, expr: string, offset: number, source: string) => {
      const trimmed = expr.trim();
      return shouldRenderBracketedMathInline(trimmed, source, offset, match.length) ? `$${trimmed}$` : `$$\n${trimmed}\n$$`;
    })
    .replace(/\\\(((?:[\s\S]*?))\\\)/g, (_, expr: string) => `$${expr.trim()}$`)
    .replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, expr: string) => `$$\n${expr.trim()}\n$$`);
}

function normalizeInlineMathCodeSpans(value: string): string {
  return value.replace(/([ \t]?)(`([^`\n]+)`)([ \t]?)/g, (match, leadingSpace: string, _fullCode: string, codeText: string, trailingSpace: string) => {
    const normalized = String(codeText || "").trim();
    if (!normalized) return match;
    if (!/\\[A-Za-z]+/.test(normalized) && !isLikelyInlineMathExpression(normalized)) return match;
    const left = leadingSpace || "";
    const right = trailingSpace || "";
    return `${left}$${normalized}$${right}`;
  });
}

function isLikelyIdentifierStyleToken(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(value)) return false;
  const [base, ...segments] = value.split("_");
  if (base.length <= 2 && segments.every((segment) => segment.length <= 3)) return false;
  return true;
}

function isLikelyInlineMathExpression(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length > 64) return false;
  if (/[\r\n`]/.test(trimmed)) return false;
  if (!/[_^]/.test(trimmed)) return false;
  if (/https?:|www\.|\.com\b|\/\//.test(trimmed)) return false;
  if (/['"]/.test(trimmed)) return false;
  if (isLikelyIdentifierStyleToken(trimmed)) return false;
  if (!/[\\^{}()]/.test(trimmed)) {
    return /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(trimmed) && /^[A-Za-z]_[A-Za-z0-9]+$/.test(trimmed);
  }
  return /^[A-Za-z\\][A-Za-z0-9\\_^{}()[\]+\-*/=|,:.]*$/.test(trimmed);
}

function normalizeBareInlineMathLikeExpressions(value: string): string {
  let out = "";
  let index = 0;
  let inInlineMath = false;
  let inBlockMath = false;
  let inCodeSpan = false;
  let inEquationEnv = false;

  while (index < value.length) {
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\begin{equation", index)) {
      inEquationEnv = true;
    }
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\end{equation", index)) {
      inEquationEnv = false;
    }

    if (!inCodeSpan && value.startsWith("$$", index)) {
      inBlockMath = !inBlockMath;
      out += "$$";
      index += 2;
      continue;
    }

    const ch = value[index];

    if (!inInlineMath && !inBlockMath && ch === "`") {
      inCodeSpan = !inCodeSpan;
      out += ch;
      index += 1;
      continue;
    }

    if (!inCodeSpan && !inBlockMath && ch === "$") {
      inInlineMath = !inInlineMath;
      out += ch;
      index += 1;
      continue;
    }

    if (!inInlineMath && !inBlockMath && !inCodeSpan && !inEquationEnv && /[A-Za-z\\]/.test(ch)) {
      let end = index;
      while (end < value.length && /[A-Za-z0-9\\_^{}()[\]+\-*/=|,:.]/.test(value[end])) {
        end += 1;
      }

      const candidate = value.slice(index, end);
      if (isLikelyInlineMathExpression(candidate)) {
        const nextChar = value[end] || "";
        out += `$${candidate}$`;
        if (nextChar === " " || nextChar === "\t") {
          out += nextChar;
          index = end + 1;
          continue;
        }
        index = end;
        continue;
      }
    }

    out += ch;
    index += 1;
  }

  return out;
}

function normalizeBareInlineLatex(value: string): string {
  const bareLatexSequenceRe =
    /^\\[A-Za-z]+(?:\{[^{}\n]*\})*(?:\([^()\n]*\))?(?:\s*(?:[=+\-*/|<>]|\\[A-Za-z]+(?:\{[^{}\n]*\})*|[A-Za-z0-9]+(?:\([^()\n]*\))?|['_^{}(),]))*/;

  let out = "";
  let index = 0;
  let inInlineMath = false;
  let inBlockMath = false;
  let inCodeSpan = false;
  let inEquationEnv = false;

  while (index < value.length) {
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\begin{equation", index)) {
      inEquationEnv = true;
    }
    if (!inCodeSpan && !inInlineMath && value.startsWith("\\end{equation", index)) {
      inEquationEnv = false;
    }

    if (!inCodeSpan && value.startsWith("$$", index)) {
      inBlockMath = !inBlockMath;
      out += "$$";
      index += 2;
      continue;
    }

    const ch = value[index];

    if (!inInlineMath && !inBlockMath && ch === "`") {
      inCodeSpan = !inCodeSpan;
      out += ch;
      index += 1;
      continue;
    }

    if (!inCodeSpan && !inBlockMath && ch === "$") {
      inInlineMath = !inInlineMath;
      out += ch;
      index += 1;
      continue;
    }

    if (!inInlineMath && !inBlockMath && !inCodeSpan && !inEquationEnv && ch === "\\") {
      const slice = value.slice(index);
      const match = slice.match(bareLatexSequenceRe);
      const commandName = slice.slice(1).match(/^[A-Za-z]+/)?.[0] || "";
      if (match && match[0] && commandName !== "begin" && commandName !== "end") {
        const nextChar = value[index + match[0].length] || "";
        out += `$${match[0].trim()}$`;
        if (nextChar === " " || nextChar === "\t") {
          out += nextChar;
          index += match[0].length + 1;
          continue;
        }
        index += match[0].length;
        continue;
      }
    }

    out += ch;
    index += 1;
  }

  return out;
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

function stripUnsupportedShellLines(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^\s*!pip\d*\s+install\b/i.test(line))
    .join("\n");
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
  return stripUnsupportedShellLines(normalizeCodeText(text));
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
    html: true,
    linkify: true,
    typographer: false,
    breaks: true
  });

  installKatexPlugin(md);

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

function installKatexPlugin(md: MarkdownIt) {
  const renderMath = (latex: string, displayMode: boolean) => {
    try {
      return katex.renderToString(latex, {
        displayMode,
        output: "htmlAndMathml",
        throwOnError: false,
        strict: "ignore",
        trust: false
      });
    } catch {
      const escaped = escapeHtml(latex);
      const safeTex = escapeHtmlAttribute(latex);
      return displayMode
        ? `<span class="katex-display" data-tex-source="${safeTex}"><code>${escaped}</code></span>`
        : `<span class="katex" data-tex-source="${safeTex}"><code>${escaped}</code></span>`;
    }
  };

  const isValidInlineMathDelimiter = (state: any, pos: number) => {
    const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
    const nextChar = pos + 1 <= state.posMax ? state.src.charCodeAt(pos + 1) : -1;

    let canOpen = true;
    let canClose = true;

    if (prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39)) {
      canClose = false;
    }
    if (nextChar === 0x20 || nextChar === 0x09) {
      canOpen = false;
    }

    return { canOpen, canClose };
  };

  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    if (state.src[state.pos] !== "$") return false;

    const delimiter = isValidInlineMathDelimiter(state, state.pos);
    if (!delimiter.canOpen) {
      if (!silent) state.pending += "$";
      state.pos += 1;
      return true;
    }

    const start = state.pos + 1;
    let match = start;
    while ((match = state.src.indexOf("$", match)) !== -1) {
      let pos = match - 1;
      while (state.src[pos] === "\\") pos -= 1;
      if ((match - pos) % 2 === 1) break;
      match += 1;
    }

    if (match === -1) {
      if (!silent) state.pending += "$";
      state.pos = start;
      return true;
    }

    if (match - start === 0) {
      if (!silent) state.pending += "$$";
      state.pos = start + 1;
      return true;
    }

    const closingDelimiter = isValidInlineMathDelimiter(state, match);
    if (!closingDelimiter.canClose) {
      if (!silent) state.pending += "$";
      state.pos = start;
      return true;
    }

    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.markup = "$";
      token.content = state.src.slice(start, match);
    }

    state.pos = match + 1;
    return true;
  });

  md.block.ruler.after("blockquote", "math_block", (state, start, end, silent) => {
    let pos = state.bMarks[start] + state.tShift[start];
    let max = state.eMarks[start];

    if (pos + 2 > max) return false;
    if (state.src.slice(pos, pos + 2) !== "$$") return false;

    pos += 2;
    let firstLine = state.src.slice(pos, max);
    let lastLine = "";
    let next = start;
    let found = false;

    if (silent) return true;

    if (firstLine.trim().endsWith("$$")) {
      firstLine = firstLine.trim().slice(0, -2);
      found = true;
    }

    while (!found) {
      next += 1;
      if (next >= end) break;

      pos = state.bMarks[next] + state.tShift[next];
      max = state.eMarks[next];

      if (pos < max && state.tShift[next] < state.blkIndent) {
        break;
      }

      if (state.src.slice(pos, max).trim().endsWith("$$")) {
        const line = state.src.slice(pos, max);
        const lastDelimiterIndex = line.lastIndexOf("$$");
        lastLine = line.slice(0, lastDelimiterIndex);
        found = true;
      }
    }

    state.line = next + 1;

    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content =
      (firstLine && firstLine.trim() ? `${firstLine}\n` : "") +
      state.getLines(start + 1, next, state.tShift[start], true) +
      (lastLine && lastLine.trim() ? lastLine : "");
    token.map = [start, state.line];
    token.markup = "$$";
    return true;
  }, {
    alt: ["paragraph", "reference", "blockquote", "list"]
  });

  md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) => `${renderMath(tokens[idx].content, true)}\n`;
}

const YOUTUBE_DIRECTIVE_GLOBAL_RE = /^\s*@\[(?:youtube|yt)\]\((https?:\/\/[^\s)]+)\)\s*$/gim;
const REFERENCE_VIDEO_HEADING_RE = /^#{1,6}\s*参考動画(?:（外部）|\(外部\))?\s*$/;
const MARKDOWN_LINK_ONLY_LINE_RE = /^(\s*(?:[-*+]\s+|\d+\.\s+)?)\[(.+?)\]\((https?:\/\/[^\s)]+)\)\s*$/;

function extractYouTubeDirectiveUrls(markdownText: string): string[] {
  return Array.from(markdownText.matchAll(YOUTUBE_DIRECTIVE_GLOBAL_RE), (match) => match[1]?.trim() || "").filter(Boolean);
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

function buildYouTubeEmbedHtmlFromUrl(rawUrl: string): string {
  const embedUrl = toYouTubeEmbedUrl(rawUrl);
  if (!embedUrl) return "";
  return [
    '<section class="yt-embed" style="margin:.9rem 0 1.2rem;">',
    '<div style="position:relative;width:100%;padding-top:56.25%;border-radius:12px;overflow:hidden;border:1px solid rgba(138,159,194,.36);background:#0a1322;">',
    `<iframe src="${embedUrl}" title="YouTube lecture reference" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0;"></iframe>`,
    "</div>",
    "</section>"
  ].join("");
}

function renderMarkdownWithInlineYouTubeEmbeds(markdownText: string): string[] {
  const pieces: string[] = [];
  const buffer: string[] = [];
  let inReferenceVideoSection = false;

  const flushBuffer = () => {
    const bufferedMarkdown = buffer.join("\n").trim();
    buffer.length = 0;
    if (bufferedMarkdown) {
      pieces.push(markdownRenderer.render(bufferedMarkdown));
    }
  };

  for (const line of markdownText.split("\n")) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushBuffer();
      inReferenceVideoSection = REFERENCE_VIDEO_HEADING_RE.test(trimmed);
      buffer.push(line);
      continue;
    }

    const linkOnlyMatch = inReferenceVideoSection ? line.match(MARKDOWN_LINK_ONLY_LINE_RE) : null;
    const youtubeUrl = linkOnlyMatch ? linkOnlyMatch[3]?.trim() || "" : "";
    const youtubeEmbedHtml = youtubeUrl ? buildYouTubeEmbedHtmlFromUrl(youtubeUrl) : "";

    if (youtubeEmbedHtml) {
      flushBuffer();
      pieces.push(markdownRenderer.render(line));
      pieces.push(youtubeEmbedHtml);
      continue;
    }

    buffer.push(line);
  }

  flushBuffer();
  return pieces;
}

export function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = normalizeCellSource(cell).trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      const normalizedMarkdown = normalizeMathDelimiters(text);
      const visibleMarkdown = stripYouTubeDirective(
        normalizeBareInlineMathLikeExpressions(normalizeBareInlineLatex(normalizeInlineMathCodeSpans(normalizedMarkdown)))
      );
      if (visibleMarkdown) {
        pieces.push(...renderMarkdownWithInlineYouTubeEmbeds(visibleMarkdown));
      }
      for (const directiveUrl of extractYouTubeDirectiveUrls(normalizedMarkdown)) {
        const youtubeEmbedHtml = buildYouTubeEmbedHtmlFromUrl(directiveUrl);
        if (youtubeEmbedHtml) {
          pieces.push(youtubeEmbedHtml);
        }
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
