import { hash } from "bcryptjs";
import { promises as fs } from "fs";
import path from "path";
import { Role } from "@prisma/client";
import { extractChunks, type NotebookFile } from "../src/lib/notebook-ingest";
import { prisma } from "../src/lib/prisma";

type Catalog = {
  chapters: Array<{
    id: string;
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

async function main() {
  const adminEmail = (process.env.ADMIN_EMAILS ?? "admin@example.com").split(",")[0]?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "password1234";

  if (adminEmail) {
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10)
      },
      create: {
        email: adminEmail,
        name: "Noema Admin",
        role: Role.ADMIN,
        passwordHash: await hash(adminPassword, 10)
      }
    });
  }

  const catalogPath = path.join(process.cwd(), "content", "catalog.json");
  const catalogRaw = await fs.readFile(catalogPath, "utf8");
  const catalog = JSON.parse(catalogRaw) as Catalog;

  const notebooks = catalog.chapters.flatMap((chapter) =>
    chapter.notebooks.map((notebook) => ({
      id: notebook.id,
      title: notebook.title,
      chapter: chapter.title,
      sortOrder: notebook.order,
      tags: notebook.tags,
      htmlPath: notebook.htmlPath,
      colabUrl: notebook.colabUrl,
      videoUrl: notebook.videoUrl
    }))
  );

  const notebookIds = notebooks.map((notebook) => notebook.id);
  await prisma.notebookChunk.deleteMany({
    where: {
      notebookId: {
        notIn: notebookIds
      }
    }
  });
  await prisma.notebook.deleteMany({
    where: {
      id: {
        notIn: notebookIds
      }
    }
  });

  for (const notebook of notebooks) {
    await prisma.notebook.upsert({
      where: { id: notebook.id },
      update: notebook,
      create: notebook
    });

    const notebookPath = path.join(process.cwd(), "content", "notebooks", `${notebook.id}.ipynb`);
    const notebookRaw = await fs.readFile(notebookPath, "utf8");
    const parsed = JSON.parse(notebookRaw) as NotebookFile;
    const chunks = extractChunks(parsed);

    await prisma.notebookChunk.deleteMany({ where: { notebookId: notebook.id } });
    for (const chunk of chunks) {
      await prisma.notebookChunk.create({
        data: { notebookId: notebook.id, sectionId: chunk.sectionId, content: chunk.content, position: chunk.position }
      });
    }
  }
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
