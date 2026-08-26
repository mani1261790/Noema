import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ARTICLE_DIRECTORY_IN_REPOSITORY =
  "vnext/apps/blog/src/content/articles";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

async function collectMarkdownFiles(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(`記事directoryでsymbolic linkを使用できません: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".md")) {
        throw new Error(`.md directoryを使用できません: ${relativePath}`);
      }
      files.push(...(await collectMarkdownFiles(path, root)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`記事directoryにはregular fileだけを配置できます: ${relativePath}`);
    }
    if (entry.name.endsWith(".md")) {
      const metadata = await stat(path);
      if ((metadata.mode & 0o111) !== 0) {
        throw new Error(`記事Markdownにexecute bitを設定できません: ${relativePath}`);
      }
      files.push(path);
    }
  }

  return files;
}

function parseFrontmatterSlug(source, relativePath) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!match) throw new Error(`frontmatterを確認できません: ${relativePath}`);

  let frontmatter;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    throw new Error(`frontmatter YAMLを解析できません: ${relativePath}`);
  }
  if (
    typeof frontmatter !== "object" ||
    frontmatter === null ||
    Array.isArray(frontmatter) ||
    typeof frontmatter.slug !== "string"
  ) {
    throw new Error(`frontmatter.slugを確認できません: ${relativePath}`);
  }
  return frontmatter.slug;
}

export async function validateArticlePaths(articleDirectory) {
  const rootMetadata = await lstat(articleDirectory);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("記事rootはsymbolic linkではないdirectoryである必要があります");
  }
  const files = await collectMarkdownFiles(articleDirectory);
  const pathBySlug = new Map();

  for (const path of files) {
    const relativePath = relative(articleDirectory, path).split(sep).join("/");
    const repositoryPath = `${ARTICLE_DIRECTORY_IN_REPOSITORY}/${relativePath}`;
    const segments = relativePath.split("/");
    const filename = basename(relativePath);
    const slug = filename.slice(0, -3);

    if (
      repositoryPath.length > 300 ||
      segments.some(
        (segment) =>
          segment.length === 0 ||
          segment === "." ||
          segment === ".." ||
          segment.startsWith(".") ||
          CONTROL_PATTERN.test(segment)
      ) ||
      !SLUG_PATTERN.test(slug) ||
      slug.length > 100
    ) {
      throw new Error(`記事pathがcanonical規則に一致しません: ${relativePath}`);
    }

    const frontmatterSlug = parseFrontmatterSlug(
      await readFile(path, "utf8"),
      relativePath
    );
    if (frontmatterSlug !== slug) {
      throw new Error(
        `filenameとfrontmatter.slugが一致しません: ${relativePath}`
      );
    }
    const existingPath = pathBySlug.get(slug);
    if (existingPath) {
      throw new Error(
        `記事slugが重複しています: ${existingPath}, ${relativePath}`
      );
    }
    pathBySlug.set(slug, relativePath);
  }

  return { articleCount: files.length };
}

const here = dirname(fileURLToPath(import.meta.url));
const defaultArticleDirectory = join(here, "..", "src", "content", "articles");
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await validateArticlePaths(defaultArticleDirectory);
  console.log(`Validated ${result.articleCount} canonical article paths.`);
}
