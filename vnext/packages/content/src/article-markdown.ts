import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  installArticleMarkdownExtensions,
  type ArticleAccordionMeta,
} from "@noema/content/article-extensions";

export type ArticleMarkdownIssueSeverity = "error" | "warning";

export type ArticleMarkdownIssueCode =
  | "empty-body"
  | "short-body"
  | "raw-html"
  | "accordion-title"
  | "accordion-unclosed"
  | "accordion-nested"
  | "h1-heading"
  | "empty-heading"
  | "heading-start"
  | "heading-order"
  | "image-alt"
  | "unsafe-image"
  | "unsafe-link"
  | "relative-link"
  | "invalid-article-link"
  | "unchecked-article-link"
  | "missing-fragment"
  | "missing-article"
  | "missing-article-fragment";

export interface ArticleMarkdownIssue {
  code: ArticleMarkdownIssueCode;
  severity: ArticleMarkdownIssueSeverity;
  message: string;
  line: number;
}

export interface ValidateArticleMarkdownOptions {
  articleSlugs?: Iterable<string>;
  articleHeadingSlugs?: ReadonlyMap<string, ReadonlySet<string>>;
  minimumCharacters?: number;
}

export type ArticleMarkdownUrlKind = "image" | "link";

export interface ArticleHeading {
  depth: number;
  line: number;
  slug: string;
  text: string;
}

interface ArticleHref {
  fragment: string | null;
  invalid: boolean;
  slug: string | null;
}

const parser = new MarkdownIt({ html: true, linkify: true });
installArticleMarkdownExtensions(parser);
const sourcePositionKey = "noemaSourcePosition";

class PositionedInlineState extends parser.inline.State {
  override push(type: string, tag: string, nesting: -1 | 0 | 1): Token {
    const sourcePosition = this.pos;
    const token = super.push(type, tag, nesting);
    token.meta = {
      ...(token.meta && typeof token.meta === "object" ? token.meta : {}),
      [sourcePositionKey]: sourcePosition,
    };
    return token;
  }
}

parser.inline.State = PositionedInlineState;

// markdown-it normally turns unsafe destinations back into plain text. The
// validator must still expose them as tokens because Astro's renderer accepts
// the same Markdown syntax and would otherwise emit the destination verbatim.
parser.validateLink = () => true;

function parsedUrl(value: string): URL | null {
  if (!value.trim()) return null;
  try {
    return new URL(value, "https://noema-learn.uk");
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(value: string): boolean {
  const url = parsedUrl(value);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

export function isSafeArticleMarkdownUrl(
  value: string,
  kind: ArticleMarkdownUrlKind,
): boolean {
  const url = parsedUrl(value);
  if (!url) return false;
  if (url.protocol === "http:" || url.protocol === "https:") return true;
  return kind === "link" && ["mailto:", "tel:"].includes(url.protocol);
}

function lineOf(token: Token): number {
  return (token.map?.[0] ?? 0) + 1;
}

function inlineTokenLine(parent: Token, child: Token): number {
  const sourcePosition = child.meta?.[sourcePositionKey];
  if (typeof sourcePosition !== "number") return lineOf(parent);
  const sourceBeforeToken = parent.content.slice(0, sourcePosition);
  return lineOf(parent) + (sourceBeforeToken.match(/\n/g)?.length ?? 0);
}

function inlineText(token?: Token, includeImages = true): string {
  return (token?.children ?? [])
    .filter(
      (child) =>
        child.type === "text" ||
        child.type === "code_inline" ||
        (includeImages && child.type === "image"),
    )
    .map((child) => child.content)
    .join("")
    .trim();
}

function collectHeadings(tokens: Token[]): ArticleHeading[] {
  const slugger = new GithubSlugger();
  const headings: ArticleHeading[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;

    const depth = Number(token.tag.slice(1));
    // Astro/Satteri omits image alt text when deriving a heading slug.
    const text = inlineText(tokens[index + 1], false);
    headings.push({
      depth,
      line: lineOf(token),
      slug: slugger.slug(text),
      text,
    });
  }

  return headings;
}

function normalizeFragment(href: string): string | null {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return null;
  }
}

function articleHref(href: string): ArticleHref | null {
  try {
    const url = new URL(href, "https://noema-learn.uk");
    const isRootRelative = href.startsWith("/") && !href.startsWith("//");
    const isCanonicalAbsolute =
      /^[a-z][a-z0-9+.-]*:/i.test(href) &&
      url.origin === "https://noema-learn.uk";
    if (!isRootRelative && !isCanonicalAbsolute) return null;
    if (url.pathname === "/articles" || url.pathname === "/articles/")
      return null;
    if (!url.pathname.startsWith("/articles/")) return null;

    const match = url.pathname.match(
      /^\/articles\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/,
    );
    const fragment = url.hash ? normalizeFragment(url.hash) : null;
    return {
      fragment,
      invalid:
        !match ||
        Boolean(url.search) ||
        (Boolean(url.hash) && fragment === null),
      slug: match?.[1] ?? null,
    };
  } catch {
    return { fragment: null, invalid: true, slug: null };
  }
}

function isRelativeLink(href: string): boolean {
  return (
    href.startsWith("//") ||
    (!href.startsWith("/") &&
      !href.startsWith("#") &&
      !/^[a-z][a-z0-9+.-]*:/i.test(href))
  );
}

function pushUnique(
  issues: ArticleMarkdownIssue[],
  issue: ArticleMarkdownIssue,
): void {
  if (
    issues.some(
      (current) =>
        current.code === issue.code &&
        current.line === issue.line &&
        current.message === issue.message,
    )
  )
    return;
  issues.push(issue);
}

export function extractArticleHeadingSlugs(source: string): string[] {
  return collectHeadings(parser.parse(source, {})).map(
    (heading) => heading.slug,
  );
}

export function extractArticleHeadings(source: string): Array<Pick<ArticleHeading, "slug" | "text">> {
  return collectHeadings(parser.parse(source, {}))
    .filter((heading) => heading.depth === 2)
    .map(({ slug, text }) => ({ slug, text }));
}

export function validateArticleMarkdown(
  source: string,
  options: ValidateArticleMarkdownOptions = {},
): ArticleMarkdownIssue[] {
  const issues: ArticleMarkdownIssue[] = [];
  const trimmed = source.trim();

  if (!trimmed) {
    return [
      {
        code: "empty-body",
        severity: "error",
        message: "本文を入力してください。",
        line: 1,
      },
    ];
  }

  const minimumCharacters = options.minimumCharacters ?? 200;
  if (trimmed.length < minimumCharacters) {
    issues.push({
      code: "short-body",
      severity: "warning",
      message: `本文が${minimumCharacters}文字未満です。公開前に内容を確認してください。`,
      line: 1,
    });
  }

  const tokens = parser.parse(source, {});
  const headings = collectHeadings(tokens);
  const headingSlugs = new Set(headings.map((heading) => heading.slug));
  const articleSlugs = options.articleSlugs
    ? new Set(options.articleSlugs)
    : null;

  let previousDepth: number | null = null;
  for (const heading of headings) {
    if (!heading.text) {
      issues.push({
        code: "empty-heading",
        severity: "error",
        message: "見出しに内容を入力してください。",
        line: heading.line,
      });
    }

    if (heading.depth === 1) {
      issues.push({
        code: "h1-heading",
        severity: "error",
        message: "本文ではH1見出しを使えません。記事タイトルがH1になります。",
        line: heading.line,
      });
    }

    if (previousDepth === null && heading.depth !== 2) {
      issues.push({
        code: "heading-start",
        severity: "error",
        message: "本文の最初の見出しはH2（##）にしてください。",
        line: heading.line,
      });
    } else if (previousDepth !== null && heading.depth > previousDepth + 1) {
      issues.push({
        code: "heading-order",
        severity: "error",
        message: `見出しレベルがH${previousDepth}からH${heading.depth}へ飛んでいます。`,
        line: heading.line,
      });
    }

    previousDepth = heading.depth;
  }

  for (const token of tokens) {
    const line = lineOf(token);

    if (token.type === "article_accordion_open") {
      const meta = token.meta as ArticleAccordionMeta;
      if (!meta.title) {
        pushUnique(issues, {
          code: "accordion-title",
          severity: "error",
          message: "アコーディオンにはタイトルを指定してください。",
          line,
        });
      }
      if (!meta.closed) {
        pushUnique(issues, {
          code: "accordion-unclosed",
          severity: "error",
          message: "アコーディオンを ::: で閉じてください。",
          line,
        });
      }
      if (meta.nested) {
        pushUnique(issues, {
          code: "accordion-nested",
          severity: "error",
          message: "アコーディオンは入れ子にできません。",
          line,
        });
      }
    }

    if (token.type === "html_block") {
      pushUnique(issues, {
        code: "raw-html",
        severity: "error",
        message: "HTMLは使用できません。Markdownで記述してください。",
        line,
      });
    }

    for (const child of token.children ?? []) {
      const childLine = inlineTokenLine(token, child);

      if (child.type === "html_inline") {
        pushUnique(issues, {
          code: "raw-html",
          severity: "error",
          message: "HTMLは使用できません。Markdownで記述してください。",
          line: childLine,
        });
      }

      if (child.type === "image") {
        if (!inlineText(child)) {
          pushUnique(issues, {
            code: "image-alt",
            severity: "error",
            message: "本文画像には代替テキストを入力してください。",
            line: childLine,
          });
        }

        const source = child.attrGet("src");
        if (source !== null && !isSafeArticleMarkdownUrl(source, "image")) {
          pushUnique(issues, {
            code: "unsafe-image",
            severity: "error",
            message:
              "画像URLにはサイト内パスまたはhttp(s) URLを使用してください。",
            line: childLine,
          });
        }
      }

      if (child.type !== "link_open") continue;
      const href = child.attrGet("href");
      if (href === null) continue;

      if (!isSafeArticleMarkdownUrl(href, "link")) {
        pushUnique(issues, {
          code: "unsafe-link",
          severity: "error",
          message:
            "リンク先にはサイト内パス、http(s)、mailto、tel URLを使用してください。",
          line: childLine,
        });
        continue;
      }

      if (href.startsWith("#")) {
        const fragment = normalizeFragment(href);
        if (!fragment || !headingSlugs.has(fragment)) {
          pushUnique(issues, {
            code: "missing-fragment",
            severity: "error",
            message: `リンク先の見出し「${href}」が本文内にありません。`,
            line: childLine,
          });
        }
        continue;
      }

      if (isRelativeLink(href)) {
        pushUnique(issues, {
          code: "relative-link",
          severity: "error",
          message:
            "サイト内リンクは / から、外部リンクはプロトコルから入力してください。",
          line: childLine,
        });
        continue;
      }

      const linkedArticle = articleHref(href);
      if (!linkedArticle) continue;

      if (linkedArticle.invalid || !linkedArticle.slug) {
        pushUnique(issues, {
          code: "invalid-article-link",
          severity: "error",
          message: "記事リンクは /articles/<slug> の形式で入力してください。",
          line: childLine,
        });
        continue;
      }

      if (!articleSlugs) {
        pushUnique(issues, {
          code: "unchecked-article-link",
          severity: "warning",
          message: "記事リンクの存在は公開ビルドで確認します。",
          line: childLine,
        });
      }

      if (articleSlugs && !articleSlugs.has(linkedArticle.slug)) {
        pushUnique(issues, {
          code: "missing-article",
          severity: "error",
          message: `リンク先の記事「${linkedArticle.slug}」が見つかりません。`,
          line: childLine,
        });
        continue;
      }

      if (linkedArticle.fragment && options.articleHeadingSlugs) {
        const targetHeadings = options.articleHeadingSlugs.get(
          linkedArticle.slug,
        );
        if (targetHeadings && !targetHeadings.has(linkedArticle.fragment)) {
          pushUnique(issues, {
            code: "missing-article-fragment",
            severity: "error",
            message: `リンク先の記事「${linkedArticle.slug}」に見出し「#${linkedArticle.fragment}」がありません。`,
            line: childLine,
          });
        }
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.line - right.line || left.severity.localeCompare(right.severity),
  );
}
