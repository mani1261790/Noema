import { describe, expect, it } from "vitest";
import {
  createSeriesOgMarkup,
  fitSeriesOgLines,
  seriesOgImagePath,
} from "./series-og";

function textContent(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textContent);
  if (!value || typeof value !== "object") return [];
  const props = (value as { props?: { children?: unknown } }).props;
  return textContent(props?.children);
}

describe("series Open Graph images", () => {
  it("fits normalized reader-facing text into a bounded number of lines", () => {
    expect(fitSeriesOgLines("  AI開発を   基礎から学ぶ  ", 9, 2)).toEqual([
      "AI開発を",
      "基礎から学ぶ",
    ]);

    const balanced = fitSeriesOgLines("AI開発を始めるための基礎から実践まで", 17.5, 2);
    expect(balanced).toEqual(["AI開発を始めるための", "基礎から実践まで"]);
    expect(balanced.every((line) => Array.from(line).length > 2)).toBe(true);

    const long = fitSeriesOgLines("あ".repeat(100), 10, 2);
    expect(long).toEqual(["あ".repeat(10), `${"あ".repeat(9)}…`]);
  });

  it("uses a content version so social caches refresh after a public series changes", () => {
    const base = {
      description: "順番に学ぶシリーズです。",
      itemCount: 3,
      slug: "learning-path",
      title: "AI開発を始める",
    };
    expect(seriesOgImagePath(base)).toMatch(/^\/og\/series\/learning-path\.png\?v=[0-9a-f]{8}$/u);
    expect(seriesOgImagePath(base)).toBe(seriesOgImagePath({ ...base }));
    expect(seriesOgImagePath(base)).not.toBe(seriesOgImagePath({ ...base, itemCount: 4 }));
  });

  it("renders only truthful public series content and its actual article count", () => {
    const markup = createSeriesOgMarkup({
      description: "AI開発を、実際の手順に沿って学びます。",
      itemCount: 12,
      title: "AI開発を始める",
    });
    const text = textContent(markup);

    expect(text).toContain("Noema");
    expect(text).toContain("シリーズ");
    expect(text).toContain("AI開発を始める");
    expect(text).toContain("全12本を順番に読む");
    expect(text).toContain("noema-learn.uk");
  });
});
