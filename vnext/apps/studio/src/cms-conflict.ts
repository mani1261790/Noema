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

const cmsConflictMetadataFieldCoverage = {
  title: true,
  description: true,
  slug: true,
  updatedAt: true,
  publishedAt: true,
  authors: true,
  topics: true,
  tags: true,
  approach: true,
  outcome: true,
  prerequisites: true,
  estimatedMinutes: true,
  heroImage: true,
  sources: true
} satisfies Record<Exclude<keyof ArticleFrontmatter, "status">, true>;

export const cmsConflictMetadataFields = Object.keys(
  cmsConflictMetadataFieldCoverage
) as Exclude<keyof ArticleFrontmatter, "status">[];

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
    stableValue(local[field]) !== stableValue(latest[field])
  );
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(
          ([left], [right]) => left.localeCompare(right)
        ))
      : item
  ) ?? "";
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
