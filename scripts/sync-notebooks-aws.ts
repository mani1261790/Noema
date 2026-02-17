import { promises as fs } from "fs";
import path from "path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { extractChunks, type NotebookFile } from "@/lib/notebook-ingest";

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

const DYNAMODB_ITEM_SOFT_LIMIT_BYTES = 350_000;
const MAX_CHUNK_CHARACTERS = 1_200;

function getArg(flag: string): string | null {
  const index = process.argv.findIndex((arg) => arg === flag);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function loadNotebookFile(notebookId: string): Promise<NotebookFile | null> {
  const candidates = [
    path.join(process.cwd(), "content", "notebooks", `${notebookId}.ipynb`),
    path.join(process.cwd(), "content", `notebooks-${notebookId}.ipynb`)
  ];

  for (const filePath of candidates) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw) as NotebookFile;
    } catch {
      continue;
    }
  }

  return null;
}

function estimateBytes(value: unknown): number {
  const marshalled = marshall(value as Record<string, unknown>, {
    removeUndefinedValues: true
  });
  return Buffer.byteLength(JSON.stringify(marshalled), "utf8");
}

function compactChunksForDynamo(baseItem: Record<string, unknown>, chunks: ReturnType<typeof extractChunks>) {
  let compacted = chunks.map((chunk) => ({
      sectionId: chunk.sectionId,
      position: chunk.position,
      content: chunk.content.slice(0, MAX_CHUNK_CHARACTERS)
    }));

  while (compacted.length > 0 && estimateBytes({ ...baseItem, chunks: compacted }) > DYNAMODB_ITEM_SOFT_LIMIT_BYTES) {
    compacted = compacted.slice(0, compacted.length - 1);
  }

  return compacted;
}

async function main() {
  const tableName =
    process.env.NOTEBOOKS_TABLE_NAME ||
    process.env.NOTEBOOKS_TABLE ||
    getArg("--table") ||
    getArg("-t") ||
    "";

  if (!tableName) {
    throw new Error("NOTEBOOKS_TABLE_NAME (or --table) is required.");
  }

  const rawCatalog = await fs.readFile(path.join(process.cwd(), "content", "catalog.json"), "utf8");
  const catalog = JSON.parse(rawCatalog) as Catalog;
  const catalogNotebookIds = new Set(
    catalog.chapters.flatMap((chapter) => chapter.notebooks.map((notebook) => notebook.id))
  );

  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true }
  });

  let staleDeleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: exclusiveStartKey,
        ProjectionExpression: "notebookId"
      })
    );

    const items = (response.Items ?? []) as Array<{ notebookId?: string }>;
    for (const item of items) {
      const notebookId = String(item.notebookId || "");
      if (!notebookId) continue;
      if (catalogNotebookIds.has(notebookId)) continue;
      await ddb.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { notebookId }
        })
      );
      staleDeleted += 1;
      console.log(`Deleted stale notebook: ${notebookId}`);
    }

    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  let synced = 0;
  for (const chapter of catalog.chapters) {
    for (const notebook of chapter.notebooks) {
      const notebookJson = await loadNotebookFile(notebook.id);
      const chunks = notebookJson ? extractChunks(notebookJson) : [];

      const existing = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { notebookId: notebook.id }
        })
      );

      const now = new Date().toISOString();
      const baseItem = {
        notebookId: notebook.id,
        title: notebook.title,
        chapter: chapter.title,
        chapterOrder: chapter.order,
        sortOrder: notebook.order,
        tags: notebook.tags,
        htmlPath: notebook.htmlPath,
        colabUrl: notebook.colabUrl,
        videoUrl: notebook.videoUrl,
        createdAt: (existing.Item as { createdAt?: string } | undefined)?.createdAt ?? now,
        updatedAt: now
      };
      const compactedChunks = compactChunksForDynamo(baseItem, chunks);

      await ddb.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            ...baseItem,
            chunks: compactedChunks
          }
        })
      );

      synced += 1;
      if (compactedChunks.length < chunks.length) {
        console.warn(
          `Synced notebook: ${notebook.id} (chunks ${chunks.length} -> ${compactedChunks.length} to fit DynamoDB limit)`
        );
      } else {
        console.log(`Synced notebook: ${notebook.id} (chunks=${compactedChunks.length})`);
      }
    }
  }

  console.log(`Done. Synced ${synced} notebooks into ${tableName}. Deleted stale: ${staleDeleted}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
