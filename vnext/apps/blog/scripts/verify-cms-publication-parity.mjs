import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ARTICLE_HREF_PATTERN = /href=(?:"|')(?<href>\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\/?)(?:"|')/gu;

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function parseExpectedArticlePaths(d1Output) {
  if (!Array.isArray(d1Output) || d1Output.length === 0) {
    throw new Error("D1 query output must be a non-empty result array.");
  }

  const paths = new Set();
  for (const query of d1Output) {
    if (!query || query.success !== true || !Array.isArray(query.results)) {
      throw new Error("D1 query did not return a successful results array.");
    }
    for (const row of query.results) {
      const slug = row?.published_slug;
      if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
        throw new Error("D1 returned an invalid published article slug.");
      }
      const path = `/articles/${slug}`;
      if (paths.has(path)) {
        throw new Error(`D1 returned a duplicate published article path: ${path}`);
      }
      paths.add(path);
    }
  }
  return sorted(paths);
}

export function parseRenderedArticlePaths(html) {
  const paths = new Set();
  for (const match of html.matchAll(ARTICLE_HREF_PATTERN)) {
    paths.add(match.groups.href.replace(/\/$/u, ""));
  }
  return sorted(paths);
}

export function verifyCmsPublicationParity(d1Output, renderedPages) {
  const expected = parseExpectedArticlePaths(d1Output);
  for (const page of renderedPages) {
    const actual = parseRenderedArticlePaths(page.html);
    const missing = expected.filter((path) => !actual.includes(path));
    const unexpected = actual.filter((path) => !expected.includes(path));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error([
        `${page.label} does not match the CMS public publication set.`,
        ...(missing.length > 0 ? [`Missing: ${missing.join(", ")}`] : []),
        ...(unexpected.length > 0 ? [`Unexpected: ${unexpected.join(", ")}`] : []),
      ].join("\n"));
    }
    console.log(`${page.label}: ${actual.length} public CMS article(s), matching D1.`);
  }
  return expected;
}

async function main([d1Path, ...pageArguments]) {
  if (!d1Path || pageArguments.length === 0) {
    throw new Error("Usage: node verify-cms-publication-parity.mjs <d1.json> <label=page.html> [...]");
  }
  const d1Output = JSON.parse(await readFile(d1Path, "utf8"));
  const renderedPages = await Promise.all(pageArguments.map(async (argument) => {
    const separator = argument.indexOf("=");
    if (separator <= 0 || separator === argument.length - 1) {
      throw new Error(`Invalid rendered page argument: ${argument}`);
    }
    return {
      label: argument.slice(0, separator),
      html: await readFile(argument.slice(separator + 1), "utf8"),
    };
  }));
  verifyCmsPublicationParity(d1Output, renderedPages);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
