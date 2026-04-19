import { promises as fs } from "fs";
import path from "path";
import { canonicalizeNotebookFile, notebookToHtml, type NotebookFile } from "../src/lib/notebook-ingest";
import { getCatalog } from "../src/lib/notebooks";
import { buildNotebookDescription } from "../src/lib/seo";
import {
  NOTEBOOK_CATALOG_SOURCE_PATH,
  NOTEBOOK_HIGHLIGHT_PUBLIC_DIR,
  NOTEBOOK_KATEX_PUBLIC_DIR,
  NOTEBOOK_PUBLIC_DIR,
  listNotebookSourceFiles
} from "../src/lib/notebook-artifacts";

async function clearNotebookOutputArtifacts() {
  const existing = await fs.readdir(NOTEBOOK_PUBLIC_DIR).catch(() => [] as string[]);
  await Promise.all(
    existing
      .filter((file) => file.endsWith(".html") || file.endsWith(".ipynb"))
      .map((file) => fs.unlink(path.join(NOTEBOOK_PUBLIC_DIR, file)))
  );
}

const DEFAULT_SITE_URL = "https://noema-learn.uk";

function normalizeSiteUrl(input?: string): string {
  const raw = String(input || "").trim();
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type NotebookPageMeta = {
  title: string;
  chapterTitle?: string;
  tags?: string[];
};

async function buildNotebookMetaMap(): Promise<Map<string, NotebookPageMeta>> {
  const catalog = await getCatalog();
  const map = new Map<string, NotebookPageMeta>();

  for (const chapter of catalog.chapters) {
    for (const notebook of chapter.notebooks) {
      map.set(notebook.id, {
        title: notebook.title,
        chapterTitle: chapter.title,
        tags: notebook.tags
      });
    }
  }

  return map;
}

function wrapNotebookHtml(pageMeta: NotebookPageMeta, bodyHtml: string, pathname: string): string {
  const safeTitle = pageMeta.title.replace(/[<>]/g, "");
  const description = buildNotebookDescription({
    title: safeTitle,
    chapterTitle: pageMeta.chapterTitle,
    tags: pageMeta.tags,
    articleHtml: bodyHtml
  });
  const pageTitle = `${safeTitle} | Noema`;
  const siteUrl = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? process.env.NEXTAUTH_URL);
  const canonicalUrl = new URL(pathname, `${siteUrl}/`).toString();
  const socialImageUrl = new URL("/noema-social-card.png", `${siteUrl}/`).toString();
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeAttribute(pageTitle)}</title>
  <meta name="description" content="${escapeAttribute(description)}" />
  <meta name="robots" content="max-snippet:160, max-image-preview:large, max-video-preview:-1" />
  <link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />
  <meta property="og:site_name" content="Noema" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${escapeAttribute(canonicalUrl)}" />
  <meta property="og:title" content="${escapeAttribute(pageTitle)}" />
  <meta property="og:description" content="${escapeAttribute(description)}" />
  <meta property="og:image" content="${escapeAttribute(socialImageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content="${escapeAttribute(safeTitle)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttribute(pageTitle)}" />
  <meta name="twitter:description" content="${escapeAttribute(description)}" />
  <meta name="twitter:image" content="${escapeAttribute(socialImageUrl)}" />
  <meta name="twitter:image:alt" content="${escapeAttribute(safeTitle)}" />
  <link rel="stylesheet" href="/highlight/atom-one-dark.min.css" />
  <link rel="stylesheet" href="/katex/katex.min.css" />
  <style>
    :root {
      --bg-0: #f3f8fb;
      --bg-1: #d7e8f4;
      --bg-2: #f9f1e7;
      --text: #09162b;
      --muted: #44556f;
      --panel: rgba(255,255,255,.72);
      --border: rgba(255,255,255,.62);
      --code-bg: #09131a;
      --code-text: #e6f0f5;
      --shadow: 0 24px 54px rgba(10, 26, 54, 0.18), inset 0 1px 0 rgba(255,255,255,.62);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-0: #071225;
        --bg-1: #0f2238;
        --bg-2: #1a2f44;
        --text: #ebf3ff;
        --muted: #9db3cf;
        --panel: rgba(12, 21, 40, 0.74);
        --border: rgba(145, 183, 227, 0.33);
        --code-bg: #040b17;
        --code-text: #e4efff;
        --shadow: 0 30px 66px rgba(2, 7, 16, 0.58), inset 0 1px 0 rgba(166,205,255,.16);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      padding: 2rem 1rem;
      color: var(--text);
      font-family: "IBM Plex Sans", system-ui, sans-serif;
      background:
        radial-gradient(circle at 12% 12%, rgba(87,196,223,.18), transparent 44%),
        radial-gradient(circle at 88% 5%, rgba(255, 155, 96, 0.16), transparent 40%),
        radial-gradient(circle at 80% 80%, rgba(109, 196, 255, 0.2), transparent 45%),
        linear-gradient(155deg, var(--bg-0) 0%, var(--bg-1) 48%, var(--bg-2) 100%);
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      border-radius: 24px;
      border: 1px solid var(--border);
      background: var(--panel);
      backdrop-filter: blur(20px) saturate(145%);
      -webkit-backdrop-filter: blur(20px) saturate(145%);
      box-shadow: var(--shadow);
      padding: 1.25rem 1.25rem 1.5rem;
    }
    .prose-noema h1, .prose-noema h2, .prose-noema h3 {
      line-height: 1.25;
      margin-top: 1.25rem;
      margin-bottom: .65rem;
    }
    .prose-noema h1 { margin-top: .1rem; font-size: 1.8rem; }
    .prose-noema h2 { font-size: 1.35rem; }
    .prose-noema p {
      line-height: 1.85;
      color: var(--text);
      margin: .7rem 0;
    }
    .prose-noema .katex {
      vertical-align: baseline;
      user-select: text;
      -webkit-user-select: text;
    }
    .prose-noema .katex,
    .prose-noema .katex-display,
    .prose-noema .katex * {
      user-select: text;
      -webkit-user-select: text;
    }
    .prose-noema .katex-display {
      overflow-x: auto;
      overflow-y: hidden;
      max-width: 100%;
    }
    .prose-noema .katex-display > .katex {
      white-space: nowrap;
    }
    .prose-noema ul, .prose-noema ol {
      margin: .7rem 0;
      padding-left: 1.4rem;
    }
    .prose-noema ul { list-style: disc; }
    .prose-noema ol { list-style: decimal; }
    .prose-noema li { margin: .28rem 0; line-height: 1.72; }
    .prose-noema a { color: inherit; text-underline-offset: 2px; }
    .prose-noema pre {
      background: var(--code-bg);
      color: var(--code-text);
      border-radius: 12px;
      padding: 1rem;
      overflow: auto;
      border: 1px solid rgba(255,255,255,.12);
    }
    .prose-noema code {
      font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .prose-noema img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
    }
  </style>
</head>
<body>
  <main>
${bodyHtml}
  </main>
  <script src="/highlight/highlight.min.js"></script>
  <script>
    (function () {
      if (!window.hljs) return;
      document.querySelectorAll("pre code").forEach(function (block) {
        window.hljs.highlightElement(block);
      });
    })();
  </script>
</body>
</html>`;
}

async function copyHighlightAssets() {
  const cssSource = path.join(process.cwd(), "node_modules", "@highlightjs", "cdn-assets", "styles", "atom-one-dark.min.css");
  const jsSource = path.join(process.cwd(), "node_modules", "@highlightjs", "cdn-assets", "highlight.min.js");
  const cssOutput = path.join(NOTEBOOK_HIGHLIGHT_PUBLIC_DIR, "atom-one-dark.min.css");
  const jsOutput = path.join(NOTEBOOK_HIGHLIGHT_PUBLIC_DIR, "highlight.min.js");

  await fs.mkdir(NOTEBOOK_HIGHLIGHT_PUBLIC_DIR, { recursive: true });
  await fs.copyFile(cssSource, cssOutput);
  await fs.copyFile(jsSource, jsOutput);
  console.log(`Copied: ${cssOutput}`);
  console.log(`Copied: ${jsOutput}`);
}

async function copyKatexAssets() {
  const katexCssSource = path.join(process.cwd(), "node_modules", "katex", "dist", "katex.min.css");
  const katexFontsSourceDir = path.join(process.cwd(), "node_modules", "katex", "dist", "fonts");
  const katexCssOutput = path.join(NOTEBOOK_KATEX_PUBLIC_DIR, "katex.min.css");
  const katexFontsOutputDir = path.join(NOTEBOOK_KATEX_PUBLIC_DIR, "fonts");

  await fs.mkdir(NOTEBOOK_KATEX_PUBLIC_DIR, { recursive: true });
  await fs.mkdir(katexFontsOutputDir, { recursive: true });
  await fs.copyFile(katexCssSource, katexCssOutput);

  const fontFiles = await fs.readdir(katexFontsSourceDir);
  await Promise.all(
    fontFiles.map((file) =>
      fs.copyFile(path.join(katexFontsSourceDir, file), path.join(katexFontsOutputDir, file))
    )
  );

  console.log(`Copied: ${katexCssOutput}`);
  console.log(`Copied: ${katexFontsOutputDir}`);
}

async function main() {
  await fs.mkdir(NOTEBOOK_PUBLIC_DIR, { recursive: true });
  await clearNotebookOutputArtifacts();
  await copyHighlightAssets();
  await copyKatexAssets();
  await fs.access(NOTEBOOK_CATALOG_SOURCE_PATH);
  const notebookMetaMap = await buildNotebookMetaMap();

  const notebookFiles = await listNotebookSourceFiles();

  for (const sourcePath of notebookFiles) {
    const raw = await fs.readFile(sourcePath, "utf8");
    const notebook = JSON.parse(raw) as NotebookFile;
    const canonicalNotebook = canonicalizeNotebookFile(notebook);
    const baseName = path.parse(sourcePath).name;
    const htmlFragment = notebookToHtml(canonicalNotebook);
    const pageMeta = notebookMetaMap.get(baseName) || { title: baseName };
    const html = wrapNotebookHtml(pageMeta, htmlFragment, `/notebooks/${baseName}.html`);
    const htmlOutputPath = path.join(NOTEBOOK_PUBLIC_DIR, `${baseName}.html`);
    const ipynbOutputPath = path.join(NOTEBOOK_PUBLIC_DIR, `${baseName}.ipynb`);

    await fs.writeFile(htmlOutputPath, html, "utf8");
    await fs.writeFile(ipynbOutputPath, `${JSON.stringify(canonicalNotebook, null, 2)}\n`, "utf8");
    console.log(`Built: ${htmlOutputPath}`);
    console.log(`Built: ${ipynbOutputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
