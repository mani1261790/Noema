import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractArticleHeadingSlugs,
  parseArticle,
  validateArticleMarkdown,
  type ArticleFrontmatter,
  type ArticleMarkdownIssue,
} from "@noema/content";

interface ArticleDocument {
  bodyLineOffset: number;
  file: string;
  frontmatter: ArticleFrontmatter;
  markdown: string;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const articlesDirectory = resolve(appDirectory, "src/content/articles");

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return findMarkdownFiles(path);
      return entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat().sort();
}

function location(
  document: ArticleDocument,
  issue: ArticleMarkdownIssue,
): string {
  return `${relative(appDirectory, document.file)}:${document.bodyLineOffset + issue.line}`;
}

function bodyLineOffset(source: string): number {
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!frontmatter) return 0;

  const body = source.slice(frontmatter[0].length);
  const leadingWhitespace = body.match(/^\s*/)?.[0].length ?? 0;
  const bodyStart = frontmatter[0].length + leadingWhitespace;
  return source.slice(0, bodyStart).split("\n").length - 1;
}

const errors: string[] = [];
const warnings: string[] = [];
const documents: ArticleDocument[] = [];

for (const file of await findMarkdownFiles(articlesDirectory)) {
  try {
    const source = await readFile(file, "utf8");
    const parsed = await parseArticle(source);
    documents.push({
      bodyLineOffset: bodyLineOffset(source),
      file,
      ...parsed,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Markdownを解析できませんでした。";
    errors.push(`${relative(appDirectory, file)}: ${message}`);
  }
}

const documentsBySlug = new Map<string, ArticleDocument[]>();
for (const document of documents) {
  const matches = documentsBySlug.get(document.frontmatter.slug) ?? [];
  matches.push(document);
  documentsBySlug.set(document.frontmatter.slug, matches);
}

for (const [slug, matches] of documentsBySlug) {
  if (matches.length < 2) continue;
  errors.push(
    `slug「${slug}」が重複しています: ${matches.map((document) => relative(appDirectory, document.file)).join(", ")}`,
  );
}

const allSlugs = new Set(
  documents.map((document) => document.frontmatter.slug),
);
const publishedSlugs = new Set(
  documents
    .filter((document) => document.frontmatter.status === "published")
    .map((document) => document.frontmatter.slug),
);
const headingSlugs = new Map(
  documents.map((document) => [
    document.frontmatter.slug,
    new Set(extractArticleHeadingSlugs(document.markdown)),
  ]),
);

for (const document of documents) {
  const availableSlugs =
    document.frontmatter.status === "published" ? publishedSlugs : allSlugs;
  const issues = validateArticleMarkdown(document.markdown, {
    articleSlugs: availableSlugs,
    articleHeadingSlugs: headingSlugs,
  });

  for (const issue of issues) {
    const message = `${location(document, issue)} ${issue.message}`;
    if (issue.severity === "error") errors.push(message);
    else warnings.push(message);
  }
}

for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);

if (errors.length > 0) {
  console.error(`記事Markdownの検証に失敗しました（${errors.length}件）。`);
  process.exitCode = 1;
} else {
  console.log(
    `記事Markdownを検証しました（${documents.length}件、警告${warnings.length}件）。`,
  );
}
