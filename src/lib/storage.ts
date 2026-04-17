import { promises as fs } from "fs";
import path from "path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  NOTEBOOK_SOURCE_DIR,
  getPreferredNotebookSourceRelativePath,
  notebookIdFromHtmlPath,
  renderNotebookHtmlFragmentFromSource,
  resolveNotebookSourcePath
} from "@/lib/notebook-artifacts";
import { canonicalizeNotebookFile } from "@/lib/notebook-ingest";

const s3Region = process.env.S3_REGION ?? process.env.AWS_REGION ?? process.env.BEDROCK_REGION;
const s3Bucket = process.env.S3_BUCKET_NAME;

const s3Client = s3Bucket && s3Region ? new S3Client({ region: s3Region }) : null;

function parseS3Path(input: string): { bucket: string; key: string } | null {
  if (!input.startsWith("s3://")) return null;
  const trimmed = input.slice("s3://".length);
  const [bucket, ...rest] = trimmed.split("/");
  if (!bucket || rest.length === 0) return null;
  return { bucket, key: rest.join("/") };
}

async function streamToString(stream: unknown): Promise<string> {
  if (!stream || typeof stream !== "object") return "";

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function saveNotebookArtifacts(params: { notebookId: string; ipynbRaw: string; html: string }) {
  const ipynbKey = `notebooks/${params.notebookId}.ipynb`;
  const htmlKey = `notebooks/${params.notebookId}.html`;

  if (s3Client && s3Bucket) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: ipynbKey,
        Body: params.ipynbRaw,
        ContentType: "application/json; charset=utf-8"
      })
    );
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: htmlKey,
        Body: params.html,
        ContentType: "text/html; charset=utf-8"
      })
    );

    return {
      htmlPath: `s3://${s3Bucket}/${htmlKey}`,
      usingS3: true
    };
  }

  await fs.mkdir(NOTEBOOK_SOURCE_DIR, { recursive: true });
  const localSourcePath = path.join(NOTEBOOK_SOURCE_DIR, getPreferredNotebookSourceRelativePath(params.notebookId));
  await fs.mkdir(path.dirname(localSourcePath), { recursive: true });
  await fs.writeFile(localSourcePath, params.ipynbRaw, "utf8");

  return {
    htmlPath: `/notebooks/${params.notebookId}.html`,
    usingS3: false
  };
}

export async function loadNotebookHtml(htmlPath: string): Promise<string> {
  const s3 = parseS3Path(htmlPath);
  if (s3 && s3Client) {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: s3.key }));
    return streamToString(response.Body);
  }

  const notebookId = notebookIdFromHtmlPath(htmlPath);
  if (notebookId) {
    try {
      return await renderNotebookHtmlFragmentFromSource(notebookId);
    } catch {
      const generatedPath = path.join(process.cwd(), "public", "notebooks", `${notebookId}.html`);
      return fs.readFile(generatedPath, "utf8");
    }
  }

  const localPath = path.join(process.cwd(), "public", htmlPath.replace(/^\//, ""));
  return fs.readFile(localPath, "utf8");
}

export async function loadNotebookIpynb(notebookId: string): Promise<string> {
  const ipynbKey = `notebooks/${notebookId}.ipynb`;
  let raw = "";

  if (s3Client && s3Bucket) {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: ipynbKey
      })
    );
    raw = await streamToString(response.Body);
  } else {
    try {
      const localPath = await resolveNotebookSourcePath(notebookId);
      raw = await fs.readFile(localPath, "utf8");
    } catch {
      const generatedPath = path.join(process.cwd(), "public", "notebooks", `${notebookId}.ipynb`);
      raw = await fs.readFile(generatedPath, "utf8");
    }
  }

  try {
    const parsed = JSON.parse(raw) as { cells?: Array<{ cell_type?: unknown; source?: unknown }> };
    const canonical = canonicalizeNotebookFile(parsed);
    return `${JSON.stringify(canonical, null, 2)}\n`;
  } catch {
    return raw;
  }
}

export function isS3Enabled() {
  return Boolean(s3Client && s3Bucket);
}
