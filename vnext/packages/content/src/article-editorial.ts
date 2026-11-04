import MarkdownIt from "markdown-it";

export interface ArticleEditorialWarning {
  code: "plain-math" | "title-numbering";
  severity: "warning";
  message: string;
  path: Array<string | number>;
}

const parser = new MarkdownIt();

function looksLikeMath(text: string): boolean {
  const prose = text.replace(/https?:\/\/\S+/gu, "");
  return /[∑∫∂√]|[A-Za-zα-ωΑ-Ω][₀-₉²³]|[A-Za-z]\^\d/u.test(prose)
    || /(?:\b[A-Za-z](?:_[A-Za-z0-9]+)?|平均|分散|損失|確率)\s*[=＝≈]\s*(?:[-−]?\d|[A-Za-zα-ω(（[])/u.test(prose)
    || /\d\s*[×÷]\s*[-−]?\d/u.test(prose);
}

/** Heuristics for editorial review, never a mathematical correctness check. */
export function articleEditorialWarnings(input: { title: string; markdown: string }): ArticleEditorialWarning[] {
  const warnings: ArticleEditorialWarning[] = [];
  if (/[⓪①-⑳]|第\s*[0-9０-９一二三四五六七八九十]+\s*[回章話]|\bpart\s*\d+\b/iu.test(input.title)) {
    warnings.push({ code: "title-numbering", severity: "warning", path: ["frontmatter", "title"], message: "タイトルに連番らしい表記があります。記事の順番はシリーズで管理し、タイトルは記事の内容を表してください。製品名や版番号の場合は残せます。" });
  }
  // Ignore supported TeX spans, preserving newlines so warnings point at source lines.
  const blank = (value: string) => value.replace(/[^\n]/gu, " ");
  const source = input.markdown.replace(/\$\$[\s\S]*?\$\$|(?<![\\$])\$(?![\s$])[^\n$]+?\$(?!\d)/gu, blank);
  const lines = new Set<number>();
  for (const token of parser.parse(source, {})) {
    if (token.type === "fence" || token.type === "code_block") {
      if (token.info.trim() && !/^(text|plaintext|plain|txt)$/iu.test(token.info.trim())) continue;
      token.content.split("\n").forEach((line, offset) => {
        if (looksLikeMath(line)) lines.add((token.map?.[0] ?? 0) + offset + (token.type === "fence" ? 2 : 1));
      });
    } else if (token.type === "inline") {
      let line = (token.map?.[0] ?? 0) + 1;
      for (const child of token.children ?? []) {
        if (child.type === "softbreak" || child.type === "hardbreak") { line += 1; continue; }
        if (child.type !== "text") continue;
        if (looksLikeMath(child.content)) lines.add(line);
      }
    }
  }
  for (const line of [...lines].sort((a, b) => a - b)) {
    warnings.push({ code: "plain-math", severity: "warning", path: ["markdown", line], message: "TeXで囲まれていない数式の候補です。数式は $...$ または $$...$$ で記述してください。コードや数式でない記述なら修正は不要です。" });
  }
  return warnings;
}
