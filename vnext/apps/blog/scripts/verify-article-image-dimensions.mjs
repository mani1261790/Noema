import { fileURLToPath } from "node:url";

const ARTICLE_HREF_PATTERN = /href=(?:"|')(?<href>\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\/?)(?:"|')/gu;
const IMAGE_TAG_PATTERN = /<img\b[^>]*>/giu;
const CMS_IMAGE_PATH_PATTERN = /^\/media\/articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp)$/iu;

export function parseArticlePaths(html) {
  return [...new Set([...html.matchAll(ARTICLE_HREF_PATTERN)]
    .map((match) => match.groups.href.replace(/\/$/u, "")))].sort();
}

export function parseCmsArticleImages(html) {
  const images = [];
  for (const match of html.matchAll(IMAGE_TAG_PATTERN)) {
    const tag = match[0];
    const source = attribute(tag, "src");
    if (!source) continue;
    let url;
    try {
      url = new URL(source, "https://noema-learn.uk");
    } catch {
      continue;
    }
    if (url.origin !== "https://noema-learn.uk" || !CMS_IMAGE_PATH_PATTERN.test(url.pathname)) continue;
    images.push({
      height: positiveInteger(attribute(tag, "height")),
      path: url.pathname,
      width: positiveInteger(attribute(tag, "width")),
    });
  }
  return images;
}

export async function verifyArticleImageDimensions(origin) {
  const normalizedOrigin = new URL(origin).origin;
  const listing = await fetchText(`${normalizedOrigin}/articles`);
  const articlePaths = parseArticlePaths(listing);
  if (articlePaths.length === 0) throw new Error("No public article paths were found.");

  const firstPages = await mapWithConcurrency(articlePaths, 6, async (path) => ({
    html: await fetchText(`${normalizedOrigin}${path}?verify-image-dimensions=backfill`),
    path,
  }));
  const imagePaths = [...new Set(firstPages.flatMap(({ html }) =>
    parseCmsArticleImages(html).map((image) => image.path)
  ))];
  if (imagePaths.length === 0) throw new Error("No CMS article images were found.");

  await mapWithConcurrency(imagePaths, 6, async (path) => {
    await fetchOk(`${normalizedOrigin}${path}?verify-image-dimensions=backfill`);
  });

  const verifiedPages = await mapWithConcurrency(articlePaths, 6, async (path) => ({
    html: await fetchText(`${normalizedOrigin}${path}?verify-image-dimensions=assert`),
    path,
  }));
  const missing = [];
  let renderedImageCount = 0;
  for (const page of verifiedPages) {
    for (const image of parseCmsArticleImages(page.html)) {
      renderedImageCount += 1;
      if (!image.width || !image.height) missing.push(`${page.path}: ${image.path}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`CMS images are missing intrinsic dimensions:\n${missing.join("\n")}`);
  }
  console.log(
    `Verified ${renderedImageCount} rendered CMS image(s) across ${articlePaths.length} article(s); ` +
    `${imagePaths.length} unique asset(s) have intrinsic dimensions.`,
  );
  return { articleCount: articlePaths.length, imageCount: renderedImageCount, uniqueImageCount: imagePaths.length };
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "iu"));
  return match?.[1] ?? match?.[2] ?? null;
}

function positiveInteger(value) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function fetchText(url) {
  const response = await fetchOk(url);
  return response.text();
}

async function fetchOk(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Noema deployment image-dimension verifier" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapWithConcurrency(values, concurrency, work) {
  const results = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.argv[2];
  if (!origin) throw new Error("Usage: node verify-article-image-dimensions.mjs <origin>");
  await verifyArticleImageDimensions(origin);
}
