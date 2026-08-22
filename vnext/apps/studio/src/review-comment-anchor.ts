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
