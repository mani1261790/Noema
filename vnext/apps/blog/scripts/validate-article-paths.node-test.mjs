import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateArticlePaths } from "./validate-article-paths.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "noema-article-paths-"));
  for (const [path, slug] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, `---\nslug: ${slug}\n---\n\nBody.\n`);
  }
  return root;
}

test("accepts flat and nested canonical article paths", async (context) => {
  const root = await fixture({ "flat.md": "flat", "guides/nested.md": "nested" });
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.doesNotReject(validateArticlePaths(root));
});

test("rejects filename and frontmatter slug mismatches", async (context) => {
  const root = await fixture({ "expected.md": "different" });
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(
    validateArticlePaths(root),
    /filenameとfrontmatter\.slugが一致しません/u
  );
});

test("rejects duplicate route slugs across nested directories", async (context) => {
  const root = await fixture({ "a/shared.md": "shared", "b/shared.md": "shared" });
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(validateArticlePaths(root), /記事slugが重複しています/u);
});

test("rejects hidden and noncanonical article path segments", async (context) => {
  const root = await fixture({ ".hidden/article.md": "article" });
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(validateArticlePaths(root), /canonical規則/u);
});

test("rejects Markdown-named directories", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "noema-article-paths-"));
  await mkdir(join(root, "archive.md"));
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(validateArticlePaths(root), /.md directory/u);
});

test("rejects executable article Markdown", async (context) => {
  const root = await fixture({ "executable.md": "executable" });
  await chmod(join(root, "executable.md"), 0o755);
  context.after(() => rm(root, { force: true, recursive: true }));

  await assert.rejects(validateArticlePaths(root), /execute bit/u);
});

test("rejects a symbolic-link article root", async (context) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "noema-article-paths-"));
  const target = join(fixtureRoot, "target");
  const link = join(fixtureRoot, "articles");
  await mkdir(target);
  await symlink(target, link);
  context.after(() => rm(fixtureRoot, { force: true, recursive: true }));

  await assert.rejects(validateArticlePaths(link), /記事root/u);
});
