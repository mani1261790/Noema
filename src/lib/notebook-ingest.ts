export type NotebookCell = {
  cell_type: "markdown" | "code";
  source?: string[];
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

function markdownToHtml(markdown: string): string {
  if (markdown.startsWith("# ")) {
    const title = markdown.slice(2);
    return `<h1 id="${slugify(title)}">${escapeHtml(title)}</h1>`;
  }
  if (markdown.startsWith("## ")) {
    const title = markdown.slice(3);
    return `<h2 id="${slugify(title)}">${escapeHtml(title)}</h2>`;
  }
  if (markdown.startsWith("### ")) {
    const title = markdown.slice(4);
    return `<h3 id="${slugify(title)}">${escapeHtml(title)}</h3>`;
  }
  return `<p>${escapeHtml(markdown)}</p>`;
}

export function notebookToHtml(input: NotebookFile): string {
  const pieces: string[] = ["<article class=\"prose-noema\">"];

  for (const cell of input.cells ?? []) {
    const text = (cell.source ?? []).join("").trim();
    if (!text) continue;

    if (cell.cell_type === "markdown") {
      for (const line of text.split("\n\n")) {
        pieces.push(markdownToHtml(line.trim()));
      }
      continue;
    }

    pieces.push(`<pre><code>${escapeHtml(text)}</code></pre>`);
  }

  pieces.push("</article>");
  return pieces.join("\n");
}

export function extractChunks(input: NotebookFile) {
  const chunks: Array<{ sectionId: string; content: string; position: number }> = [];
  let sectionId = "intro";
  let position = 0;

  for (const cell of input.cells ?? []) {
    const raw = (cell.source ?? []).join("").trim();
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
