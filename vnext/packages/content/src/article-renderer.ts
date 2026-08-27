import GithubSlugger from "github-slugger";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import katex from "katex";
import MarkdownIt from "markdown-it";
import { installArticleMarkdownExtensions } from "@noema/content/article-extensions";
import type { ImageDimensions } from "@noema/content/image-metadata";

function isSafeRendererUrl(value: string, kind: "image" | "link"): boolean {
  try {
    const url = new URL(value, "https://noema-learn.uk");
    if (url.protocol === "http:" || url.protocol === "https:") return true;
    return kind === "link" && (url.protocol === "mailto:" || url.protocol === "tel:");
  } catch {
    return false;
  }
}

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLanguage);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "jsx", "ts", "tsx"], { languageName: "typescript" });

export interface ArticleMarkdownRendererOptions {
  externalLinksInNewTab?: boolean;
  resolveImageDimensions?: (reference: string) => ImageDimensions | null | undefined;
  resolveLinkAvailability?: (reference: string) => "available" | "unavailable";
  resolveImageReference?: (reference: string) => string;
  resolveLinkReference?: (reference: string) => string;
}

interface ArticleMarkdownEnvironment {
  headingSlugger: GithubSlugger;
}

function highlightMarkdownCode(source: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();
  return hljs.highlight(source, {
    ignoreIllegals: true,
    language: normalizedLanguage && hljs.getLanguage(normalizedLanguage)
      ? normalizedLanguage
      : "plaintext",
  }).value;
}

function installKatexRenderer(markdown: MarkdownIt): void {
  const renderMath = (latex: string, displayMode: boolean) => katex.renderToString(latex, {
    displayMode,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });

  const delimiterState = (state: { src: string; posMax: number }, position: number) => {
    const previous = position > 0 ? state.src.charCodeAt(position - 1) : -1;
    const next = position + 1 <= state.posMax ? state.src.charCodeAt(position + 1) : -1;
    return {
      canClose: previous !== 0x20 && previous !== 0x09 && !(next >= 0x30 && next <= 0x39),
      canOpen: next !== 0x20 && next !== 0x09,
    };
  };

  markdown.inline.ruler.after("escape", "math_inline", (state, silent) => {
    if (state.src[state.pos] !== "$" || state.src[state.pos + 1] === "$") return false;
    const opening = delimiterState(state, state.pos);
    if (!opening.canOpen) return false;

    const start = state.pos + 1;
    let match = start;
    while ((match = state.src.indexOf("$", match)) !== -1) {
      let escapedAt = match - 1;
      while (state.src[escapedAt] === "\\") escapedAt -= 1;
      if ((match - escapedAt) % 2 === 1) break;
      match += 1;
    }
    if (match === -1 || match === start || !delimiterState(state, match).canClose) return false;

    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(start, match);
      token.markup = "$";
    }
    state.pos = match + 1;
    return true;
  });

  markdown.block.ruler.after("blockquote", "math_block", (state, startLine, endLine, silent) => {
    let position = state.bMarks[startLine] + state.tShift[startLine];
    let maximum = state.eMarks[startLine];
    if (state.src.slice(position, position + 2) !== "$$") return false;
    if (silent) return true;

    position += 2;
    let firstLine = state.src.slice(position, maximum);
    let lastLine = "";
    let nextLine = startLine;
    let found = false;
    if (firstLine.trim().endsWith("$$")) {
      firstLine = firstLine.trim().slice(0, -2);
      found = true;
    }

    while (!found) {
      nextLine += 1;
      if (nextLine >= endLine) break;
      position = state.bMarks[nextLine] + state.tShift[nextLine];
      maximum = state.eMarks[nextLine];
      if (position < maximum && state.tShift[nextLine] < state.blkIndent) break;
      const line = state.src.slice(position, maximum);
      if (line.trim().endsWith("$$")) {
        lastLine = line.slice(0, line.lastIndexOf("$$"));
        found = true;
      }
    }

    state.line = nextLine + 1;
    const token = state.push("math_block", "math", 0);
    token.block = true;
    token.content =
      (firstLine.trim() ? `${firstLine}\n` : "") +
      state.getLines(startLine + 1, nextLine, state.tShift[startLine], true) +
      (lastLine.trim() ? lastLine : "");
    token.map = [startLine, state.line];
    token.markup = "$$";
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });

  markdown.renderer.rules.math_inline = (tokens, index) => renderMath(tokens[index].content, false);
  markdown.renderer.rules.math_block = (tokens, index) => `${renderMath(tokens[index].content, true)}\n`;
}

export function createArticleMarkdownRenderer(
  options: ArticleMarkdownRendererOptions = {},
): MarkdownIt {
  const markdown = new MarkdownIt({
    highlight: highlightMarkdownCode,
    html: false,
    linkify: true,
    typographer: false,
  });
  installKatexRenderer(markdown);
  installArticleMarkdownExtensions(markdown);
  markdown.validateLink = (value) => isSafeRendererUrl(value, "link");

  const defaultImageRule = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, index, rendererOptions, environment, self) => {
    const token = tokens[index];
    const source = token.attrGet("src") ?? "";
    if (!isSafeRendererUrl(source, "image")) return markdown.utils.escapeHtml(token.content);
    const dimensions = options.resolveImageDimensions?.(source);
    if (dimensions) {
      token.attrSet("width", String(dimensions.width));
      token.attrSet("height", String(dimensions.height));
    }
    if (options.resolveImageReference) token.attrSet("src", options.resolveImageReference(source));
    return defaultImageRule
      ? defaultImageRule(tokens, index, rendererOptions, environment, self)
      : self.renderToken(tokens, index, rendererOptions);
  };

  const defaultLinkRule = markdown.renderer.rules.link_open;
  const defaultLinkCloseRule = markdown.renderer.rules.link_close;
  markdown.renderer.rules.link_open = (tokens, index, rendererOptions, environment, self) => {
    const token = tokens[index];
    const href = token.attrGet("href");
    if (href && options.resolveLinkAvailability?.(href) === "unavailable") {
      token.tag = "span";
      token.attrs = [["class", "article-link-unavailable"]];
      const closing = tokens.slice(index + 1).find((candidate) => candidate.type === "link_close");
      if (closing) {
        closing.tag = "span";
        closing.meta = { ...(closing.meta ?? {}), articleLinkUnavailable: true };
      }
      return self.renderToken(tokens, index, rendererOptions);
    }
    if (href && options.resolveLinkReference) token.attrSet("href", options.resolveLinkReference(href));
    if (href && options.externalLinksInNewTab && !href.startsWith("#")) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noreferrer");
    }
    return defaultLinkRule
      ? defaultLinkRule(tokens, index, rendererOptions, environment, self)
      : self.renderToken(tokens, index, rendererOptions);
  };
  markdown.renderer.rules.link_close = (tokens, index, rendererOptions, environment, self) => {
    if (tokens[index].meta?.articleLinkUnavailable === true) {
      return `${self.renderToken(tokens, index, rendererOptions)}<span class="article-link-unavailable__status">（現在は公開されていません）</span>`;
    }
    return defaultLinkCloseRule
      ? defaultLinkCloseRule(tokens, index, rendererOptions, environment, self)
      : self.renderToken(tokens, index, rendererOptions);
  };

  markdown.renderer.rules.heading_open = (tokens, index, rendererOptions, environment, self) => {
    const inline = tokens[index + 1];
    const headingText = (inline?.children ?? [])
      .filter((child) => child.type === "text" || child.type === "code_inline")
      .map((child) => child.content)
      .join("")
      .trim();
    const runtime = environment as Partial<ArticleMarkdownEnvironment>;
    runtime.headingSlugger ??= new GithubSlugger();
    tokens[index].attrSet("id", runtime.headingSlugger.slug(headingText));
    return self.renderToken(tokens, index, rendererOptions);
  };

  const defaultTableOpenRule = markdown.renderer.rules.table_open;
  const defaultTableCloseRule = markdown.renderer.rules.table_close;
  markdown.renderer.rules.table_open = (tokens, index, rendererOptions, environment, self) => {
    const table = defaultTableOpenRule
      ? defaultTableOpenRule(tokens, index, rendererOptions, environment, self)
      : self.renderToken(tokens, index, rendererOptions);
    return `<div class="article-table-scroll" role="region" aria-label="記事内の表" tabindex="0">${table}`;
  };
  markdown.renderer.rules.table_close = (tokens, index, rendererOptions, environment, self) => {
    const table = defaultTableCloseRule
      ? defaultTableCloseRule(tokens, index, rendererOptions, environment, self)
      : self.renderToken(tokens, index, rendererOptions);
    return `${table}</div>`;
  };

  return markdown;
}

const articleMarkdownRenderer = createArticleMarkdownRenderer();

export function renderArticleMarkdown(source: string): string {
  return articleMarkdownRenderer.render(source, { headingSlugger: new GithubSlugger() });
}

export function renderArticleMarkdownWith(
  renderer: MarkdownIt,
  source: string,
): string {
  return renderer.render(source, { headingSlugger: new GithubSlugger() });
}
