import type { CmsReviewCommentAnchor } from "@noema/cms";

const CONTEXT_LENGTH = 80;

export function createReviewCommentAnchor(
  markdown: string,
  startOffset: number,
  endOffset: number
): CmsReviewCommentAnchor | null {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > markdown.length
  ) return null;
  const quote = markdown.slice(startOffset, endOffset);
  if (!quote.trim() || quote.length > 1_000) return null;
  return {
    endOffset,
    prefix: markdown.slice(Math.max(0, startOffset - CONTEXT_LENGTH), startOffset),
    quote,
    startOffset,
    suffix: markdown.slice(endOffset, endOffset + CONTEXT_LENGTH)
  };
}

export function createReviewCommentAnchorFromRenderedSelection(
  markdown: string,
  selection: string,
  renderedPrefix = "",
  renderedSuffix = ""
): CmsReviewCommentAnchor | null {
  const trimmedSelection = selection.trim();
  if (!trimmedSelection || trimmedSelection.length > 1_000) return null;

  const candidates = findSelectionCandidates(markdown, trimmedSelection);
  if (candidates.length === 0) return null;

  const prefixContext = renderedPrefix.slice(-CONTEXT_LENGTH);
  const suffixContext = renderedSuffix.slice(0, CONTEXT_LENGTH);
  const selected = candidates.map(({ startOffset, endOffset }) => ({
    endOffset,
    score: commonSuffixLength(
      markdown.slice(Math.max(0, startOffset - prefixContext.length), startOffset),
      prefixContext
    ) + commonPrefixLength(
      markdown.slice(endOffset, endOffset + suffixContext.length),
      suffixContext
    ),
    startOffset
  })).sort((left, right) => right.score - left.score || left.startOffset - right.startOffset)[0];
  if (!selected) return null;

  return createReviewCommentAnchor(markdown, selected.startOffset, selected.endOffset);
}

export function getRenderedReviewCommentQuote(markdownQuote: string): string {
  return projectMarkdownText(markdownQuote).text.trim();
}

export function locateReviewCommentAnchor(
  markdown: string,
  anchor: CmsReviewCommentAnchor
): { endOffset: number; exact: boolean; startOffset: number } | null {
  if (markdown.slice(anchor.startOffset, anchor.endOffset) === anchor.quote) {
    return {
      endOffset: anchor.endOffset,
      exact: true,
      startOffset: anchor.startOffset
    };
  }

  const occurrences: number[] = [];
  let cursor = 0;
  while (cursor <= markdown.length - anchor.quote.length) {
    const found = markdown.indexOf(anchor.quote, cursor);
    if (found < 0) break;
    occurrences.push(found);
    cursor = found + Math.max(1, anchor.quote.length);
  }
  if (occurrences.length === 0) return null;

  const scored = occurrences.map((startOffset) => {
    const prefix = markdown.slice(Math.max(0, startOffset - anchor.prefix.length), startOffset);
    const suffix = markdown.slice(
      startOffset + anchor.quote.length,
      startOffset + anchor.quote.length + anchor.suffix.length
    );
    return {
      score: commonSuffixLength(prefix, anchor.prefix) + commonPrefixLength(suffix, anchor.suffix),
      startOffset
    };
  }).sort((left, right) => right.score - left.score || (
    Math.abs(left.startOffset - anchor.startOffset) - Math.abs(right.startOffset - anchor.startOffset)
  ));
  const startOffset = scored[0]?.startOffset;
  return startOffset === undefined ? null : {
    endOffset: startOffset + anchor.quote.length,
    exact: false,
    startOffset
  };
}

function commonPrefixLength(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  let length = 0;
  while (length < maximum && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  let length = 0;
  while (length < maximum && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function findSelectionCandidates(
  markdown: string,
  selection: string
): Array<{ endOffset: number; startOffset: number }> {
  const exact: Array<{ endOffset: number; startOffset: number }> = [];
  let cursor = 0;
  while (cursor <= markdown.length - selection.length) {
    const startOffset = markdown.indexOf(selection, cursor);
    if (startOffset < 0) break;
    exact.push({ endOffset: startOffset + selection.length, startOffset });
    cursor = startOffset + Math.max(1, selection.length);
  }
  if (exact.length > 0) return exact;

  const projected = projectMarkdownText(markdown);
  const projectedSelection = normalizeRenderedText(selection);
  if (!projectedSelection) return [];
  const candidates: Array<{ endOffset: number; startOffset: number }> = [];
  cursor = 0;
  while (cursor <= projected.text.length - projectedSelection.length) {
    const projectedStart = projected.text.indexOf(projectedSelection, cursor);
    if (projectedStart < 0) break;
    const projectedEnd = projectedStart + projectedSelection.length - 1;
    const startOffset = projected.offsets[projectedStart];
    const finalOffset = projected.offsets[projectedEnd];
    if (startOffset !== undefined && finalOffset !== undefined) {
      candidates.push({ endOffset: finalOffset + 1, startOffset });
    }
    cursor = projectedStart + Math.max(1, projectedSelection.length);
  }
  return candidates;
}

function projectMarkdownText(markdown: string): { offsets: number[]; text: string } {
  const offsets: number[] = [];
  let text = "";
  let index = 0;
  while (index < markdown.length) {
    const character = markdown[index] ?? "";
    if (character === "]" && markdown[index + 1] === "(") {
      const targetEnd = markdown.indexOf(")", index + 2);
      if (targetEnd >= 0) {
        index = targetEnd + 1;
        continue;
      }
    }
    if (character === "\\" && index + 1 < markdown.length) {
      index += 1;
      appendProjectedCharacter(markdown[index] ?? "", index, offsets, (value) => { text += value; });
      index += 1;
      continue;
    }
    if ("*_~`[]".includes(character) || (character === "!" && markdown[index + 1] === "[")) {
      index += 1;
      continue;
    }
    appendProjectedCharacter(character, index, offsets, (value) => { text += value; });
    index += 1;
  }
  return { offsets, text };
}

function appendProjectedCharacter(
  character: string,
  offset: number,
  offsets: number[],
  append: (value: string) => void
): void {
  if (/\s/u.test(character)) {
    if (offsets.length === 0 || offsets[offsets.length - 1] === -1) return;
    append(" ");
    offsets.push(-1);
    return;
  }
  if (offsets[offsets.length - 1] === -1) offsets[offsets.length - 1] = offset;
  append(character);
  offsets.push(offset);
}

function normalizeRenderedText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
