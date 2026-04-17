import { promises as fs } from "fs";
import path from "path";
import {
  NOTEBOOK_CATALOG_SOURCE_PATH,
  NOTEBOOK_HIGHLIGHT_PUBLIC_DIR,
  NOTEBOOK_KATEX_PUBLIC_DIR,
  NOTEBOOK_PUBLIC_DIR
} from "../src/lib/notebook-artifacts";

async function clearNotebookOutputArtifacts() {
  const existing = await fs.readdir(NOTEBOOK_PUBLIC_DIR).catch(() => [] as string[]);
  await Promise.all(
    existing
      .filter((file) => file.endsWith(".html") || file.endsWith(".ipynb"))
      .map((file) => fs.unlink(path.join(NOTEBOOK_PUBLIC_DIR, file)))
  );
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
