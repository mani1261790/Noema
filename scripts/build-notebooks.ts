import { promises as fs } from "fs";
import path from "path";
import { canonicalizeNotebookFile, notebookToHtml, type NotebookFile } from "../src/lib/notebook-ingest";

const NOTEBOOK_SOURCE_DIR = path.join(process.cwd(), "content", "notebooks");
const OUTPUT_DIR = path.join(process.cwd(), "public", "notebooks");
const HIGHLIGHT_OUTPUT_DIR = path.join(process.cwd(), "public", "highlight");
const KATEX_OUTPUT_DIR = path.join(process.cwd(), "public", "katex");
const CATALOG_SOURCE_PATH = path.join(process.cwd(), "content", "catalog.json");
const CATALOG_OUTPUT_PATH = path.join(process.cwd(), "public", "catalog.json");

function wrapNotebookHtml(title: string, bodyHtml: string): string {
  const safeTitle = title.replace(/[<>]/g, "");
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
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
  const cssOutput = path.join(HIGHLIGHT_OUTPUT_DIR, "atom-one-dark.min.css");
  const jsOutput = path.join(HIGHLIGHT_OUTPUT_DIR, "highlight.min.js");

  await fs.mkdir(HIGHLIGHT_OUTPUT_DIR, { recursive: true });
  await fs.copyFile(cssSource, cssOutput);
  await fs.copyFile(jsSource, jsOutput);
  console.log(`Copied: ${cssOutput}`);
  console.log(`Copied: ${jsOutput}`);
}

async function copyKatexAssets() {
  const katexCssSource = path.join(process.cwd(), "node_modules", "katex", "dist", "katex.min.css");
  const katexFontsSourceDir = path.join(process.cwd(), "node_modules", "katex", "dist", "fonts");
  const katexCssOutput = path.join(KATEX_OUTPUT_DIR, "katex.min.css");
  const katexFontsOutputDir = path.join(KATEX_OUTPUT_DIR, "fonts");

  await fs.mkdir(KATEX_OUTPUT_DIR, { recursive: true });
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
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await copyHighlightAssets();
  await copyKatexAssets();

  const files = await fs.readdir(NOTEBOOK_SOURCE_DIR);
  const notebookFiles = files.filter((file) => file.endsWith(".ipynb"));

  for (const file of notebookFiles) {
    const sourcePath = path.join(NOTEBOOK_SOURCE_DIR, file);
    const raw = await fs.readFile(sourcePath, "utf8");
    const notebook = JSON.parse(raw) as NotebookFile;
    const canonicalNotebook = canonicalizeNotebookFile(notebook);
    const canonicalRaw = `${JSON.stringify(canonicalNotebook, null, 2)}\n`;
    const htmlFragment = notebookToHtml(canonicalNotebook);
    const title = path.parse(file).name;
    const html = wrapNotebookHtml(title, htmlFragment);
    const outputName = `${path.parse(file).name}.html`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`Built: ${outputPath}`);

    const ipynbOutputPath = path.join(OUTPUT_DIR, file);
    await fs.writeFile(ipynbOutputPath, canonicalRaw, "utf8");
    console.log(`Copied: ${ipynbOutputPath}`);
  }

  await fs.copyFile(CATALOG_SOURCE_PATH, CATALOG_OUTPUT_PATH);
  console.log(`Copied: ${CATALOG_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
