import { promises as fs } from "fs";
import path from "path";
import { notebookToHtml, type NotebookFile } from "../src/lib/notebook-ingest";

const NOTEBOOK_SOURCE_DIR = path.join(process.cwd(), "content", "notebooks");
const OUTPUT_DIR = path.join(process.cwd(), "public", "notebooks");
const CATALOG_SOURCE_PATH = path.join(process.cwd(), "content", "catalog.json");
const CATALOG_OUTPUT_PATH = path.join(process.cwd(), "public", "catalog.json");

function wrapNotebookHtml(title: string, bodyHtml: string): string {
  const safeTitle = title.replace(/[<>]/g, "");
  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    "  <style>",
    "    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 2rem 1rem; background: #f4f8fb; color: #102027; }",
    "    main { max-width: 960px; margin: 0 auto; background: rgba(255,255,255,0.82); border: 1px solid rgba(255,255,255,0.6); border-radius: 20px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); padding: 1.5rem; }",
    "    .prose-noema h1, .prose-noema h2, .prose-noema h3 { color: #0b2d3f; line-height: 1.3; }",
    "    .prose-noema h1 { margin-top: 0; font-size: 1.8rem; }",
    "    .prose-noema h2 { margin-top: 1.2rem; font-size: 1.35rem; }",
    "    .prose-noema p { line-height: 1.85; margin: 0.7rem 0; }",
    "    .prose-noema pre { background: #09131a; color: #e6f0f5; border-radius: 12px; padding: 1rem; overflow: auto; }",
    "    @media (prefers-color-scheme: dark) {",
    "      body { background: #081018; color: #d3e6ef; }",
    "      main { background: rgba(20,29,38,0.72); border-color: rgba(255,255,255,0.12); }",
    "      .prose-noema h1, .prose-noema h2, .prose-noema h3 { color: #e8f6ff; }",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    bodyHtml,
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const files = await fs.readdir(NOTEBOOK_SOURCE_DIR);
  const notebookFiles = files.filter((file) => file.endsWith(".ipynb"));

  for (const file of notebookFiles) {
    const sourcePath = path.join(NOTEBOOK_SOURCE_DIR, file);
    const raw = await fs.readFile(sourcePath, "utf8");
    const notebook = JSON.parse(raw) as NotebookFile;
    const htmlFragment = notebookToHtml(notebook);
    const title = path.parse(file).name;
    const html = wrapNotebookHtml(title, htmlFragment);
    const outputName = `${path.parse(file).name}.html`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`Built: ${outputPath}`);

    const ipynbOutputPath = path.join(OUTPUT_DIR, file);
    await fs.writeFile(ipynbOutputPath, raw, "utf8");
    console.log(`Copied: ${ipynbOutputPath}`);
  }

  await fs.copyFile(CATALOG_SOURCE_PATH, CATALOG_OUTPUT_PATH);
  console.log(`Copied: ${CATALOG_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
