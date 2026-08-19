import { diffLines } from "diff";
import type { ArticleFrontmatter } from "@noema/content";

export type CmsConflictChoice = "latest" | "local";

export type CmsConflictMetadataChoices = Partial<Record<keyof ArticleFrontmatter, CmsConflictChoice>>;

export type CmsBodyConflictBlock =
  | {
      id: string;
      kind: "common";
      text: string;
    }
  | {
      id: string;
      kind: "choice";
      latestText: string;
      localText: string;
    };

export const cmsConflictMetadataFields = [
  "title",
  "description",
  "slug",
  "updatedAt",
  "publishedAt",
  "authors",
  "topics",
  "tags",
  "approach",
  "outcome",
  "prerequisites",
  "estimatedMinutes",
  "heroImage",
  "sources"
] as const satisfies readonly (keyof ArticleFrontmatter)[];

export function buildCmsBodyConflictBlocks(
  localBody: string,
  latestBody: string
): CmsBodyConflictBlock[] {
  const blocks: CmsBodyConflictBlock[] = [];
  let latestText = "";
  let localText = "";
  let choiceNumber = 0;
  let commonNumber = 0;

  const flushChoice = () => {
    if (!latestText && !localText) return;
    choiceNumber += 1;
    blocks.push({
      id: `change-${choiceNumber}`,
      kind: "choice",
      latestText,
      localText
    });
    latestText = "";
    localText = "";
  };

  for (const part of diffLines(latestBody, localBody)) {
    if (part.added) {
      localText += part.value;
    } else if (part.removed) {
      latestText += part.value;
    } else {
      flushChoice();
      commonNumber += 1;
      blocks.push({ id: `common-${commonNumber}`, kind: "common", text: part.value });
    }
  }
  flushChoice();
  return blocks;
}

export function mergeCmsBodyConflictBlocks(
  blocks: CmsBodyConflictBlock[],
  choices: Record<string, CmsConflictChoice>
): string {
  return blocks.map((block) => {
    if (block.kind === "common") return block.text;
    return (choices[block.id] ?? "local") === "local" ? block.localText : block.latestText;
  }).join("");
}

export function changedCmsMetadataFields(
  local: ArticleFrontmatter,
  latest: ArticleFrontmatter
): (keyof ArticleFrontmatter)[] {
  return cmsConflictMetadataFields.filter((field) =>
    JSON.stringify(local[field]) !== JSON.stringify(latest[field])
  );
}

export function mergeCmsConflictFrontmatter(
  local: ArticleFrontmatter,
  latest: ArticleFrontmatter,
  choices: CmsConflictMetadataChoices
): ArticleFrontmatter {
  const merged = { ...latest } as Record<string, unknown>;
  for (const field of cmsConflictMetadataFields) {
    if ((choices[field] ?? "local") !== "local") continue;
    const value = local[field];
    if (value === undefined) delete merged[field];
    else merged[field] = value;
  }
  return merged as unknown as ArticleFrontmatter;
}
