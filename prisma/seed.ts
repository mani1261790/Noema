import { hash } from "bcryptjs";
import { promises as fs } from "fs";
import path from "path";
import { Role } from "@prisma/client";
import { extractChunks, type NotebookFile } from "../src/lib/notebook-ingest";
import { prisma } from "../src/lib/prisma";

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

  const notebooks = [
    {
      id: "intro-llm",
      title: "LLM入門: トークンと推論",
      chapter: "機械学習とLLMの基礎",
      sortOrder: 1,
      tags: ["llm", "token", "prompt"],
      htmlPath: "/notebooks/intro-llm.html",
      colabUrl:
        "https://colab.research.google.com/github/googlecolab/colabtools/blob/main/notebooks/colab-github-demo.ipynb",
      videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    },
    {
      id: "ml-regression-basics",
      title: "線形回帰の基礎",
      chapter: "機械学習とLLMの基礎",
      sortOrder: 2,
      tags: ["machine-learning", "regression"],
      htmlPath: "/notebooks/ml-regression-basics.html",
      colabUrl: "https://colab.research.google.com/github/googlecolab/colabtools/blob/main/notebooks/snippets/markdown.ipynb",
      videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
    },
    {
      id: "rl-world-model-intro",
      title: "強化学習と世界モデル入門",
      chapter: "強化学習と世界モデル",
      sortOrder: 1,
      tags: ["rl", "world-model"],
      htmlPath: "/notebooks/rl-world-model-intro.html",
      colabUrl: "https://colab.research.google.com/github/googlecolab/colabtools/blob/main/notebooks/snippets/images.ipynb",
      videoUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
    }
  ] as const;

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
