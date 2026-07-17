import { isSafeArticleMarkdownUrl } from "@noema/content";
import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";

interface RuntimeMarkdownEnvironment {
  headingSlugger: GithubSlugger;
}

const parser = new MarkdownIt({
  html: false,
  linkify: true,
});

parser.validateLink = (value) => isSafeArticleMarkdownUrl(value, "link");

const defaultImageRule = parser.renderer.rules.image;
parser.renderer.rules.image = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const source = token.attrGet("src") ?? "";
  if (!isSafeArticleMarkdownUrl(source, "image")) {
    return parser.utils.escapeHtml(token.content);
  }
  return defaultImageRule
    ? defaultImageRule(tokens, index, options, environment, self)
    : self.renderToken(tokens, index, options);
};

parser.renderer.rules.heading_open = (tokens, index, options, environment, self) => {
  const inline = tokens[index + 1];
  const headingText = (inline?.children ?? [])
    .filter((child) => child.type === "text" || child.type === "code_inline")
    .map((child) => child.content)
    .join("")
    .trim();
  const runtime = environment as RuntimeMarkdownEnvironment;
  tokens[index].attrSet("id", runtime.headingSlugger.slug(headingText));
  return self.renderToken(tokens, index, options);
};

export function renderArticleMarkdown(source: string): string {
  return parser.render(source, { headingSlugger: new GithubSlugger() });
}
