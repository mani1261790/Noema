import { promises as fs } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { extractChunks, type NotebookFile } from "../src/lib/notebook-ingest";

type Catalog = {
  chapters: Array<{
    title: string;
    order: number;
    notebooks: Array<{
      id: string;
      title: string;
      order: number;
      tags: string[];
      htmlPath: string;
      colabUrl: string;
      videoUrl?: string;
    }>;
  }>;
};

const prisma = new PrismaClient();

const catalogPath = path.join(process.cwd(), "content", "catalog.json");
const notebookDir = path.join(process.cwd(), "content", "notebooks");

async function main() {
  const raw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;

  for (const chapter of catalog.chapters) {
    for (const notebook of chapter.notebooks) {
      await prisma.notebook.upsert({
        where: { id: notebook.id },
        update: {
          title: notebook.title,
          chapter: chapter.title,
          sortOrder: notebook.order,
          tags: notebook.tags,
          htmlPath: notebook.htmlPath,
          colabUrl: notebook.colabUrl,
          videoUrl: notebook.videoUrl ?? null
        },
        create: {
          id: notebook.id,
          title: notebook.title,
          chapter: chapter.title,
          sortOrder: notebook.order,
          tags: notebook.tags,
          htmlPath: notebook.htmlPath,
          colabUrl: notebook.colabUrl,
          videoUrl: notebook.videoUrl ?? null
        }
      });

      const ipynbPath = path.join(notebookDir, `${notebook.id}.ipynb`);
      const notebookRaw = await fs.readFile(ipynbPath, "utf8");
      const notebookJson = JSON.parse(notebookRaw) as NotebookFile;
      const chunks = extractChunks(notebookJson);

      await prisma.notebookChunk.deleteMany({ where: { notebookId: notebook.id } });
      if (chunks.length > 0) {
        await prisma.notebookChunk.createMany({
          data: chunks.map((chunk) => ({
            notebookId: notebook.id,
            sectionId: chunk.sectionId,
            content: chunk.content,
            position: chunk.position
          }))
        });
      }
    }
  }

  console.log("Notebook metadata/chunks synchronized.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
