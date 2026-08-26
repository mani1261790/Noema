import { diffArrays, diffLines } from "diff";
import type { ArticleFrontmatter } from "@noema/content";
import type { CmsVisibility } from "@noema/cms";

export type CmsConflictChoice = "latest" | "local";

export type CmsConflictMetadataChoices = Partial<Record<keyof ArticleFrontmatter, CmsConflictChoice>>;

export interface CmsDraftContent {
  body: string;
  frontmatter: ArticleFrontmatter;
  visibility: CmsVisibility;
}

export interface CmsDraftMergeResult {
  conflicts: {
    body: boolean;
    metadataFields: (keyof ArticleFrontmatter)[];
    visibility: boolean;
  };
  draft: CmsDraftContent;
  kind: "conflict" | "merged";
}

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

export function mergeCmsDraftOntoLatest(input: {
  base: CmsDraftContent;
  latest: CmsDraftContent;
  local: CmsDraftContent;
}): CmsDraftMergeResult {
  const metadataFields: (keyof ArticleFrontmatter)[] = [];
  const mergedFrontmatter = { ...input.latest.frontmatter } as Record<string, unknown>;

  for (const field of cmsConflictMetadataFields) {
    const baseValue = stableValue(input.base.frontmatter[field]);
    const latestValue = stableValue(input.latest.frontmatter[field]);
    const localValue = stableValue(input.local.frontmatter[field]);
    const localChanged = localValue !== baseValue;
    const latestChanged = latestValue !== baseValue;

    if (localChanged && latestChanged && localValue !== latestValue) metadataFields.push(field);
    if (!localChanged) continue;
    const value = input.local.frontmatter[field];
    if (value === undefined) delete mergedFrontmatter[field];
    else mergedFrontmatter[field] = value;
  }

  const bodyMerge = mergeTextOntoLatest(
    input.base.body,
    input.local.body,
    input.latest.body
  );
  const visibility = mergeScalar(
    input.base.visibility,
    input.local.visibility,
    input.latest.visibility
  );
  const hasConflict = bodyMerge.conflict || metadataFields.length > 0 || visibility.conflict;

  return {
    conflicts: {
      body: bodyMerge.conflict,
      metadataFields,
      visibility: visibility.conflict
    },
    draft: {
      body: bodyMerge.value,
      frontmatter: mergedFrontmatter as unknown as ArticleFrontmatter,
      visibility: visibility.value
    },
    kind: hasConflict ? "conflict" : "merged"
  };
}

interface TextEdit {
  end: number;
  replacement: string[];
  start: number;
}

function mergeTextOntoLatest(
  base: string,
  local: string,
  latest: string
): { conflict: boolean; value: string } {
  const baseLines = splitLines(base);
  const localEdits = buildTextEdits(baseLines, splitLines(local));
  const latestEdits = buildTextEdits(baseLines, splitLines(latest));
  const mergedEdits = [...localEdits];
  let conflict = false;

  for (const latestEdit of latestEdits) {
    const overlapping = localEdits.filter((localEdit) => editsOverlap(localEdit, latestEdit));
    if (overlapping.some((localEdit) => sameEdit(localEdit, latestEdit))) continue;
    if (overlapping.length > 0) {
      // Keep the browser-side text in the recoverable draft. The resolver only
      // needs to ask about the overlapping part; unrelated CMS changes remain.
      conflict = true;
      continue;
    }
    mergedEdits.push(latestEdit);
  }

  return {
    conflict,
    value: applyTextEdits(baseLines, mergedEdits)
  };
}

function splitLines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function buildTextEdits(base: string[], variant: string[]): TextEdit[] {
  const edits: TextEdit[] = [];
  let baseIndex = 0;
  let pending: TextEdit | null = null;

  const flush = () => {
    if (!pending) return;
    edits.push(pending);
    pending = null;
  };

  for (const part of diffArrays(base, variant)) {
    const values = part.value as string[];
    if (!part.added && !part.removed) {
      flush();
      baseIndex += values.length;
      continue;
    }
    pending ??= { end: baseIndex, replacement: [], start: baseIndex };
    if (part.removed) {
      baseIndex += values.length;
      pending.end = baseIndex;
    } else {
      pending.replacement.push(...values);
    }
  }
  flush();
  return edits;
}

function editsOverlap(left: TextEdit, right: TextEdit): boolean {
  const leftInsertion = left.start === left.end;
  const rightInsertion = right.start === right.end;
  if (leftInsertion && rightInsertion) return left.start === right.start;
  if (leftInsertion) return left.start >= right.start && left.start <= right.end;
  if (rightInsertion) return right.start >= left.start && right.start <= left.end;
  return left.start < right.end && right.start < left.end;
}

function sameEdit(left: TextEdit, right: TextEdit): boolean {
  return left.start === right.start &&
    left.end === right.end &&
    stableValue(left.replacement) === stableValue(right.replacement);
}

function applyTextEdits(base: string[], edits: TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  const output: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    output.push(...base.slice(cursor, edit.start), ...edit.replacement);
    cursor = edit.end;
  }
  output.push(...base.slice(cursor));
  return output.join("");
}

function mergeScalar<T>(
  base: T,
  local: T,
  latest: T
): { conflict: boolean; value: T } {
  const localChanged = local !== base;
  const latestChanged = latest !== base;
  return {
    conflict: localChanged && latestChanged && local !== latest,
    value: localChanged ? local : latest
  };
}
