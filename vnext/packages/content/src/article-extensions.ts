import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";
import type Token from "markdown-it/lib/token.mjs";

export const articleAccordionName = "accordion";
export const articleMarkdownGuidance = [
  "記事本文はMarkdownで記述し、raw HTMLは使用しません。",
  "折りたたみ補足は `:::accordion タイトル` で開始し、通常のMarkdown本文を書いた後、単独行の `:::` で閉じます。",
  "アコーディオンは入れ子にせず、タイトルを必ず指定してください。",
].join(" ");

export interface ArticleAccordionMeta {
  closed: boolean;
  nested: boolean;
  title: string;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(
    state.bMarks[line] + state.tShift[line],
    state.eMarks[line],
  );
}

function offsetTokenMaps(tokens: Token[], offset: number): void {
  for (const token of tokens) {
    if (token.map) token.map = [token.map[0] + offset, token.map[1] + offset];
    if (token.children) offsetTokenMaps(token.children, offset);
  }
}

export function installArticleMarkdownExtensions(markdown: MarkdownIt): void {
  markdown.block.ruler.before(
    "fence",
    "article_accordion",
    (state, startLine, endLine, silent) => {
      const opening = lineText(state, startLine).match(/^:::accordion(?:[ \t]+(.+?))?[ \t]*$/);
      if (!opening) return false;
      if (silent) return true;

      let closingLine = startLine + 1;
      let depth = 1;
      let nested = false;
      while (closingLine < endLine) {
        const candidate = lineText(state, closingLine).trim();
        if (/^:::accordion(?:[ \t]|$)/.test(candidate)) {
          depth += 1;
          nested = true;
        } else if (candidate === ":::") {
          depth -= 1;
          if (depth === 0) break;
        }
        closingLine += 1;
      }
      const closed = closingLine < endLine;
      const contentEnd = closed ? closingLine : endLine;
      const meta: ArticleAccordionMeta = {
        closed,
        nested,
        title: opening[1]?.trim() ?? "",
      };

      const open = state.push("article_accordion_open", "details", 1);
      open.block = true;
      open.map = [startLine, closed ? closingLine + 1 : endLine];
      open.meta = meta;

      const contentStart = startLine + 1;
      if (contentStart < contentEnd) {
        const content = state.getLines(contentStart, contentEnd, state.blkIndent, false);
        const children: Token[] = [];
        state.md.block.parse(content, state.md, state.env, children);
        offsetTokenMaps(children, contentStart);
        state.tokens.push(...children);
      }

      const close = state.push("article_accordion_close", "details", -1);
      close.block = true;
      close.meta = meta;
      state.line = closed ? closingLine + 1 : endLine;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );

  markdown.renderer.rules.article_accordion_open = (tokens, index) => {
    const meta = tokens[index].meta as ArticleAccordionMeta;
    return `<details class="article-accordion"><summary>${markdown.utils.escapeHtml(meta.title)}</summary><div class="article-accordion__content">\n`;
  };
  markdown.renderer.rules.article_accordion_close = () => "</div></details>\n";
}
