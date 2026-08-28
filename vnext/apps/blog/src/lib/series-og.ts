import type { ReactElement } from "react";

export const SERIES_OG_IMAGE_HEIGHT = 630;
export const SERIES_OG_IMAGE_WIDTH = 1200;

interface SeriesOgInput {
  description: string;
  itemCount: number;
  title: string;
}

interface SeriesOgImagePathInput extends SeriesOgInput {
  slug: string;
}

type ElementStyle = Record<string, boolean | number | string>;

function element(
  type: string,
  style: ElementStyle,
  children: ReactElement | ReactElement[] | string | string[],
): ReactElement {
  return { type, props: { children, style } } as ReactElement;
}

function characterWidth(character: string): number {
  if (character === " ") return 0.35;
  return /^[\u0021-\u007e]$/u.test(character) ? 0.55 : 1;
}

function textWidth(value: string): number {
  return Array.from(value).reduce((total, character) => total + characterWidth(character), 0);
}

const UNDESIRABLE_LINE_START = /^[、。）」』】！？!?,.;:のをがにでとへはもやかねよ]/u;

function characterGroup(character: string): string {
  if (/\p{Script=Han}/u.test(character)) return "han";
  if (/\p{Script=Hiragana}/u.test(character)) return "hiragana";
  if (/\p{Script=Katakana}/u.test(character)) return "katakana";
  if (/[A-Za-z]/u.test(character)) return "latin";
  if (/[0-9]/u.test(character)) return "number";
  return "other";
}

function naturalBoundaryBonus(characters: string[], split: number): number {
  const left = characters[split - 1] ?? "";
  const right = characters[split] ?? "";
  if (left === " " || right === " ") return 4;
  if (/[、。！？!?]/u.test(left)) return 4;
  return characterGroup(left) !== characterGroup(right) ? 3 : 0;
}

function balanceTwoLines(characters: string[], maximumLineWidth: number): string[] | null {
  let best: { lines: [string, string]; score: number } | null = null;
  const hasWordBoundaries = characters.includes(" ");

  for (let split = 1; split < characters.length; split += 1) {
    const first = characters.slice(0, split).join("").trimEnd();
    const second = characters.slice(split).join("").trimStart();
    if (!first || !second) continue;

    const firstWidth = textWidth(first);
    const secondWidth = textWidth(second);
    if (firstWidth > maximumLineWidth || secondWidth > maximumLineWidth) continue;

    const shortLastLinePenalty = Array.from(second).length <= 2 ? 100 : 0;
    const awkwardStartPenalty = UNDESIRABLE_LINE_START.test(second) ? 2 : 0;
    const brokenWordPenalty = hasWordBoundaries
      && characters[split - 1] !== " "
      && characters[split] !== " "
      ? 4
      : 0;
    const score = Math.abs(firstWidth - secondWidth)
      + shortLastLinePenalty
      + awkwardStartPenalty
      + brokenWordPenalty
      - naturalBoundaryBonus(characters, split);
    if (!best || score < best.score) best = { lines: [first, second], score };
  }

  return best?.lines ?? null;
}

export function fitSeriesOgLines(
  value: string,
  maximumLineWidth: number,
  maximumLines: number,
): string[] {
  const characters = Array.from(value.trim().replace(/\s+/gu, " "));
  if (characters.length === 0 || maximumLineWidth <= 0 || maximumLines <= 0) return [];

  const lines: string[] = [];
  let index = 0;

  while (index < characters.length && lines.length < maximumLines) {
    let line = "";
    while (index < characters.length) {
      const next = `${line}${characters[index]}`;
      if (line && textWidth(next) > maximumLineWidth) break;
      line = next;
      index += 1;
    }

    lines.push(line.trimEnd());
    while (characters[index] === " ") index += 1;
  }

  if (index < characters.length && lines.length > 0) {
    let lastLine = lines.at(-1) ?? "";
    while (lastLine && textWidth(`${lastLine}…`) > maximumLineWidth) {
      lastLine = Array.from(lastLine).slice(0, -1).join("").trimEnd();
    }
    lines[lines.length - 1] = `${lastLine}…`;
  } else if (lines.length === 2) {
    const balanced = balanceTwoLines(characters, maximumLineWidth);
    if (balanced) return balanced;
  }

  return lines;
}

function contentVersion(input: SeriesOgInput): string {
  const value = `${input.title}\u0000${input.description}\u0000${input.itemCount}`;
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function seriesOgImagePath(input: SeriesOgImagePathInput): string {
  return `/og/series/${input.slug}.png?v=${contentVersion(input)}`;
}

export function createSeriesOgMarkup(input: SeriesOgInput): ReactElement {
  const titleLines = fitSeriesOgLines(input.title, 17.5, 2);
  const descriptionLines = fitSeriesOgLines(input.description, 34, 2);
  const articleCount = `全${input.itemCount}本を順番に読む`;

  return element("div", {
    width: SERIES_OG_IMAGE_WIDTH,
    height: SERIES_OG_IMAGE_HEIGHT,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "60px 72px",
    background: "#faf9f5",
    color: "#1c2422",
    fontFamily: "Noto Sans JP",
  }, [
    element("div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottom: "3px solid #00645f",
      paddingBottom: 22,
    }, [
      element("div", { display: "flex", fontSize: 40, color: "#00645f" }, "Noema"),
      element("div", { display: "flex", fontSize: 24, color: "#44504d" }, "シリーズ"),
    ]),
    element("div", {
      display: "flex",
      flex: 1,
      flexDirection: "column",
      justifyContent: "center",
      padding: "28px 0 24px",
    }, [
      element("div", {
        display: "flex",
        flexDirection: "column",
        fontSize: 58,
        lineHeight: 1.34,
        letterSpacing: "0.01em",
      }, titleLines.map((line) => element("div", {
        display: "flex",
        flexShrink: 0,
        height: 78,
        width: "100%",
      }, line))),
      element("div", {
        display: "flex",
        flexDirection: "column",
        marginTop: 18,
        fontSize: 28,
        lineHeight: 1.55,
        color: "#44504d",
      }, descriptionLines.map((line) => element("div", {
        display: "flex",
        flexShrink: 0,
        height: 44,
        width: "100%",
      }, line))),
    ]),
    element("div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 22,
      color: "#44504d",
    }, [
      element("div", { display: "flex", fontSize: 25, color: "#00645f" }, articleCount),
      element("div", { display: "flex" }, "noema-learn.uk"),
    ]),
  ]);
}
