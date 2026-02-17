import { promises as fs } from "fs";
import path from "path";
import { notebookToHtml, type NotebookFile } from "../src/lib/notebook-ingest";

const NOTEBOOK_SOURCE_DIR = path.join(process.cwd(), "content", "notebooks");
const OUTPUT_DIR = path.join(process.cwd(), "public", "notebooks");

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const files = await fs.readdir(NOTEBOOK_SOURCE_DIR);
  const notebookFiles = files.filter((file) => file.endsWith(".ipynb"));

  for (const file of notebookFiles) {
    const sourcePath = path.join(NOTEBOOK_SOURCE_DIR, file);
    const raw = await fs.readFile(sourcePath, "utf8");
    const notebook = JSON.parse(raw) as NotebookFile;
    const html = notebookToHtml(notebook);
    const outputName = `${path.parse(file).name}.html`;
    const outputPath = path.join(OUTPUT_DIR, outputName);
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`Built: ${outputPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
