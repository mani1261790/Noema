import { promises as fs } from "fs";
import path from "path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type AssessmentStorageKind = "notebook-checks" | "chapter-finals";

const LOCAL_ASSESSMENT_ROOT = path.join(process.cwd(), "content", "assessments");
const s3Region = process.env.S3_REGION ?? process.env.AWS_REGION ?? process.env.BEDROCK_REGION;
const assessmentBucket =
  process.env.ASSESSMENT_BUCKET_NAME ?? process.env.NOTEBOOK_BUCKET ?? process.env.S3_BUCKET_NAME ?? "";

const s3Client = assessmentBucket && s3Region ? new S3Client({ region: s3Region }) : null;

async function streamToString(stream: unknown): Promise<string> {
  if (!stream || typeof stream !== "object") return "";

  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function localAssessmentPath(kind: AssessmentStorageKind, id: string) {
  return path.join(LOCAL_ASSESSMENT_ROOT, kind, `${id}.json`);
}

export async function loadAssessmentJson(kind: AssessmentStorageKind, id: string): Promise<unknown | null> {
  if (s3Client && assessmentBucket) {
    try {
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: assessmentBucket,
          Key: `assessments/${kind}/${id}.json`
        })
      );
      return JSON.parse(await streamToString(response.Body)) as unknown;
    } catch {
      return null;
    }
  }

  try {
    return JSON.parse(await fs.readFile(localAssessmentPath(kind, id), "utf8")) as unknown;
  } catch {
    return null;
  }
}
