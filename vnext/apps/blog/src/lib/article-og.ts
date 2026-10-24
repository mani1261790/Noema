import type { ReactElement } from "react";
import { fitSeriesOgLines } from "./series-og";

export interface ArticleOgInput { title: string; topic: string }
export const ARTICLE_OG_WIDTH = 1200;
export const ARTICLE_OG_HEIGHT = 630;

export function articleOgImagePath(input: ArticleOgInput & { slug: string }): string {
  // Include the design revision as well as all displayed content in the cache key.
  let hash = 0x811c9dc5;
  for (const c of JSON.stringify([3, input.title, input.topic])) {
    hash = Math.imul(hash ^ (c.codePointAt(0) ?? 0), 0x01000193);
  }
  return `/og/articles/${encodeURIComponent(input.slug)}.png?v=${(hash >>> 0).toString(16)}`;
}

export function fitArticleTitle(title: string): string[] {
  const width = (text: string) => Array.from(text).reduce((sum, c) => sum + (/^[\u0020-\u007e]$/u.test(c) ? 0.55 : 1), 0);
  const words = Array.from(new Intl.Segmenter("ja", { granularity: "word" }).segment(title.trim().replace(/\s+/gu, " ")), part => part.segment);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    // Long identifiers still need a bounded fallback.
    if (width(word) > 17.5) return fitSeriesOgLines(title, 17.5, 3);
    if (line && width(line + word) > 17.5 && !/^[、。）」』】！？]/u.test(word)) {
      lines.push(line.trim());
      line = word;
    } else line += word;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > 3) return [...lines.slice(0, 2), ...fitSeriesOgLines(lines.slice(2).join(""), 17.5, 1)];
  return lines;
}

export function createArticleOgMarkup(input: ArticleOgInput): ReactElement {
  const el = (style: Record<string, string | number>, children: string | ReactElement[]): ReactElement =>
    ({ type: "div", props: { style: { display: "flex", ...style }, children } } as ReactElement);
  const lines = fitArticleTitle(input.title);
  return el({ width: 1200, height: 630, flexDirection: "column", padding: "54px 72px", background: "#faf9f5", color: "#1c2422", fontFamily: "Noto Sans JP" }, [
    el({ alignItems: "center", justifyContent: "space-between" }, [
      el({ fontSize: 38, color: "#00645f" }, "Noema"),
      el({ fontSize: 24, color: "#00645f", background: "#e4efeb", padding: "8px 24px", borderRadius: 8 }, "記事"),
    ]),
    el({ flex: 1, flexDirection: "column", justifyContent: "center", fontSize: 56, lineHeight: 1.35 },
      lines.map(line => el({ height: 76, flexShrink: 0 }, line))),
    el({ borderTop: "2px solid #c8d6d0", paddingTop: 22, alignItems: "center", justifyContent: "space-between", fontSize: 24, color: "#44504d" }, [
      el({}, fitSeriesOgLines(input.topic, 25, 1)[0] ?? ""),
      el({ fontSize: 22 }, "noema-learn.uk"),
    ]),
  ]);
}
