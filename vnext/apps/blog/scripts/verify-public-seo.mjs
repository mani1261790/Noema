import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const CANONICAL_ORIGIN = "https://noema-learn.uk";
const MAX_CONCURRENCY = 6;
const SERIES_OG_IMAGE_HEIGHT = 630;
const SERIES_OG_IMAGE_WIDTH = 1200;
const HTML_TAG_PATTERN = /<(?<name>[a-z][a-z0-9:-]*)\b(?<attributes>[^>]*)>/giu;
const ATTRIBUTE_PATTERN = /(?<name>[^\s=/>]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gu;

export function parseSitemap(xml, canonicalOrigin = CANONICAL_ORIGIN) {
  const entries = [...xml.matchAll(/<url>(?<body>[\s\S]*?)<\/url>/giu)].map((match) => ({
    lastModified: decodeEntities(elementText(match.groups.body, "lastmod")),
    url: decodeEntities(elementText(match.groups.body, "loc")),
  }));
  if (entries.length === 0) throw new Error("The sitemap does not contain any URLs.");

  const errors = [];
  const seen = new Set();
  for (const entry of entries) {
    let url;
    try {
      url = new URL(entry.url);
    } catch {
      errors.push(`Invalid sitemap URL: ${entry.url || "(empty)"}`);
      continue;
    }
    if (url.origin !== canonicalOrigin) errors.push(`${entry.url}: URL is outside ${canonicalOrigin}.`);
    if (url.search || url.hash) errors.push(`${entry.url}: sitemap URLs must not contain a query or fragment.`);
    if (seen.has(url.href)) errors.push(`${entry.url}: duplicate sitemap URL.`);
    seen.add(url.href);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry.lastModified)) {
      errors.push(`${entry.url}: lastmod must use YYYY-MM-DD.`);
    }
  }
  if (errors.length > 0) throw new Error(`Invalid sitemap:\n${errors.join("\n")}`);
  return entries;
}

export function parseRssFeed(xml) {
  const channel = elementText(xml, "channel");
  if (!channel) throw new Error("The RSS feed does not contain a channel.");

  const items = [...channel.matchAll(/<item>(?<body>[\s\S]*?)<\/item>/giu)].map((match) => {
    const guidTag = match.groups.body.match(/<guid\b(?<attributes>[^>]*)>/iu);
    const guidAttributes = parseAttributes(guidTag?.groups?.attributes ?? "");
    return {
      guid: decodeEntities(elementText(match.groups.body, "guid")),
      guidIsPermaLink: guidAttributes.ispermalink?.toLowerCase() === "true",
      link: decodeEntities(elementText(match.groups.body, "link")),
    };
  });

  return {
    channelLink: decodeEntities(elementText(channel, "link")),
    items,
  };
}

export function validateRssFeed(feed, sitemapEntries, canonicalOrigin = CANONICAL_ORIGIN) {
  const errors = [];
  if (feed.channelLink !== `${canonicalOrigin}/`) {
    errors.push(`channel link is ${feed.channelLink || "empty"}.`);
  }

  const expectedArticleUrls = sitemapEntries
    .map((entry) => entry.url)
    .filter((url) => new URL(url).pathname.startsWith("/articles/"));
  const expected = new Set(expectedArticleUrls);
  const observed = new Set();

  for (const item of feed.items) {
    let url;
    try {
      url = new URL(item.link);
    } catch {
      errors.push(`item link is invalid: ${item.link || "empty"}.`);
      continue;
    }
    if (url.origin !== canonicalOrigin) errors.push(`${item.link}: item link is outside ${canonicalOrigin}.`);
    if (url.search || url.hash) errors.push(`${item.link}: item link must not contain a query or fragment.`);
    if (observed.has(item.link)) errors.push(`${item.link}: duplicate RSS item link.`);
    observed.add(item.link);
    if (!expected.has(item.link)) errors.push(`${item.link}: item link is not a canonical public article URL.`);
    if (item.guid !== item.link) errors.push(`${item.link}: GUID does not match the item link.`);
    if (!item.guidIsPermaLink) errors.push(`${item.link}: GUID must declare isPermaLink=true.`);
  }

  for (const expectedUrl of expectedArticleUrls) {
    if (!observed.has(expectedUrl)) errors.push(`${expectedUrl}: public article is missing from RSS.`);
  }
  return errors;
}

export function inspectSeoDocument(html, canonicalUrl) {
  const tags = [...html.matchAll(HTML_TAG_PATTERN)].map((match) => ({
    attributes: parseAttributes(match.groups.attributes),
    name: match.groups.name.toLowerCase(),
  }));
  const meta = new Map();
  const properties = new Map();
  for (const tag of tags.filter((item) => item.name === "meta")) {
    const name = tag.attributes.name?.toLowerCase();
    const property = tag.attributes.property?.toLowerCase();
    if (name) meta.set(name, tag.attributes.content ?? "");
    if (property) properties.set(property, tag.attributes.content ?? "");
  }
  const links = tags.filter((item) => item.name === "link");
  const canonicalLinks = links.filter((item) => relValues(item.attributes.rel).includes("canonical"));
  const rssLinks = links.filter((item) => (
    relValues(item.attributes.rel).includes("alternate") &&
    item.attributes.type?.toLowerCase() === "application/rss+xml"
  ));
  const imageTags = tags.filter((item) => item.name === "img");
  const htmlTag = tags.find((item) => item.name === "html");
  const title = decodeEntities(elementText(html, "title")).replace(/\s+/gu, " ").trim();
  const h1 = [...html.matchAll(/<h1\b[^>]*>(?<body>[\s\S]*?)<\/h1>/giu)]
    .map((match) => textContent(match.groups.body));
  const jsonLd = [];
  const jsonErrors = [];
  for (const match of html.matchAll(/<script\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/script>/giu)) {
    const attributes = parseAttributes(match.groups.attributes);
    if (attributes.type?.toLowerCase() !== "application/ld+json") continue;
    try {
      jsonLd.push(JSON.parse(match.groups.body));
    } catch (error) {
      jsonErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const schemaTypes = new Set();
  const websites = [];
  const collectionPages = [];
  for (const value of jsonLd) collectSchemaTypes(value, schemaTypes);
  for (const value of jsonLd) collectSchemaNodes(value, "WebSite", websites);
  for (const value of jsonLd) collectSchemaNodes(value, "CollectionPage", collectionPages);

  return {
    canonical: canonicalLinks[0]?.attributes.href ?? "",
    canonicalCount: canonicalLinks.length,
    collectionPages,
    description: meta.get("description") ?? "",
    h1,
    htmlLanguage: htmlTag?.attributes.lang ?? "",
    jsonErrors,
    jsonLdCount: jsonLd.length,
    missingImageAltCount: imageTags.filter((item) => !("alt" in item.attributes)).length,
    openGraph: {
      description: properties.get("og:description") ?? "",
      image: properties.get("og:image") ?? "",
      imageAlt: properties.get("og:image:alt") ?? "",
      imageHeight: properties.get("og:image:height") ?? "",
      imageWidth: properties.get("og:image:width") ?? "",
      title: properties.get("og:title") ?? "",
      url: properties.get("og:url") ?? "",
    },
    robots: meta.get("robots") ?? "",
    rss: rssLinks[0]?.attributes.href ? new URL(rssLinks[0].attributes.href, canonicalUrl).href : "",
    rssCount: rssLinks.length,
    schemaTypes,
    title,
    twitter: {
      card: meta.get("twitter:card") ?? "",
      description: meta.get("twitter:description") ?? "",
      image: meta.get("twitter:image") ?? "",
      imageAlt: meta.get("twitter:image:alt") ?? "",
      title: meta.get("twitter:title") ?? "",
    },
    websites,
  };
}

export function validateSeoDocument(document, canonicalUrl) {
  const errors = [];
  const pathname = new URL(canonicalUrl).pathname;
  if (document.htmlLanguage !== "ja") errors.push(`html lang must be ja, received ${document.htmlLanguage || "empty"}.`);
  if (!document.title) errors.push("title is missing.");
  if (!document.description) errors.push("meta description is missing.");
  if (document.canonicalCount !== 1) errors.push(`expected one canonical link, received ${document.canonicalCount}.`);
  if (document.canonical !== canonicalUrl) errors.push(`canonical is ${document.canonical || "empty"}.`);
  if (document.h1.length !== 1 || !document.h1[0]) errors.push(`expected one non-empty h1, received ${document.h1.length}.`);

  const robots = new Set(document.robots.toLowerCase().split(",").map((value) => value.trim()).filter(Boolean));
  if (!robots.has("index") || !robots.has("follow")) errors.push(`robots must include index,follow, received ${document.robots || "empty"}.`);
  if (robots.has("noindex") || robots.has("nofollow")) errors.push(`robots blocks indexing: ${document.robots}.`);
  if (document.missingImageAltCount > 0) errors.push(`${document.missingImageAltCount} image(s) omit alt.`);
  if (document.rssCount !== 1 || document.rss !== `${CANONICAL_ORIGIN}/rss.xml`) {
    errors.push(`expected one canonical RSS alternate, received ${document.rss || "empty"}.`);
  }

  const expectedSocialValues = [
    ["og:title", document.openGraph.title],
    ["og:description", document.openGraph.description],
    ["og:image", document.openGraph.image],
    ["twitter:title", document.twitter.title],
    ["twitter:description", document.twitter.description],
    ["twitter:image", document.twitter.image],
  ];
  for (const [label, value] of expectedSocialValues) {
    if (!value) errors.push(`${label} is missing.`);
  }
  if (!document.openGraph.imageAlt) errors.push("og:image:alt is missing.");
  if (!document.twitter.imageAlt) errors.push("twitter:image:alt is missing.");
  if (document.twitter.image !== document.openGraph.image) {
    errors.push("twitter:image must match og:image.");
  }
  if (document.twitter.imageAlt !== document.openGraph.imageAlt) {
    errors.push("twitter:image:alt must match og:image:alt.");
  }
  if (document.openGraph.url !== canonicalUrl) errors.push(`og:url is ${document.openGraph.url || "empty"}.`);
  if (document.twitter.card !== "summary_large_image") {
    errors.push(`twitter:card is ${document.twitter.card || "empty"}.`);
  }
  try {
    if (new URL(document.openGraph.image).origin !== CANONICAL_ORIGIN) errors.push("og:image must use the canonical origin.");
  } catch {
    errors.push("og:image must be an absolute URL.");
  }

  if (document.jsonErrors.length > 0) errors.push(`invalid JSON-LD: ${document.jsonErrors.join("; ")}`);
  if (document.jsonLdCount === 0) errors.push("JSON-LD is missing.");
  for (const schemaType of requiredSchemaTypes(pathname)) {
    if (!document.schemaTypes.has(schemaType)) errors.push(`JSON-LD type ${schemaType} is missing.`);
  }
  if (pathname === "/") {
    const website = document.websites.find((candidate) => candidate.url === `${CANONICAL_ORIGIN}/`)
      ?? document.websites[0];
    if (website) {
      if (website.name !== "Noema") errors.push(`WebSite name is ${website.name || "empty"}.`);
      const alternateNames = Array.isArray(website.alternateName)
        ? website.alternateName
        : [website.alternateName];
      if (!alternateNames.includes("noema-learn.uk")) {
        errors.push("WebSite alternateName must include noema-learn.uk.");
      }
    }
  }
  errors.push(...validateSeriesSeoDocument(document, canonicalUrl));
  return errors;
}

export function validateSeriesSeoDocument(document, canonicalUrl) {
  const canonical = new URL(canonicalUrl);
  const match = canonical.pathname.match(/^\/series\/(?<slug>[a-z0-9-]+)$/u);
  if (!match) return [];

  const errors = [];
  let imageUrl;
  try {
    imageUrl = new URL(document.openGraph.image);
  } catch {
    errors.push("series og:image must be an absolute URL.");
  }
  if (imageUrl) {
    const expectedPathname = `/og/series/${match.groups.slug}.png`;
    if (imageUrl.origin !== CANONICAL_ORIGIN || imageUrl.pathname !== expectedPathname) {
      errors.push(`series og:image must use ${CANONICAL_ORIGIN}${expectedPathname}.`);
    }
    if (!/^\?v=[0-9a-f]{8}$/u.test(imageUrl.search)) {
      errors.push("series og:image must include an eight-character content version.");
    }
  }
  if (document.openGraph.imageWidth !== String(SERIES_OG_IMAGE_WIDTH)) {
    errors.push(`series og:image:width must be ${SERIES_OG_IMAGE_WIDTH}.`);
  }
  if (document.openGraph.imageHeight !== String(SERIES_OG_IMAGE_HEIGHT)) {
    errors.push(`series og:image:height must be ${SERIES_OG_IMAGE_HEIGHT}.`);
  }

  const collection = document.collectionPages.find((candidate) => candidate.url === canonicalUrl);
  if (!collection) {
    errors.push("series CollectionPage JSON-LD for the canonical URL is missing.");
    return errors;
  }

  const itemList = collection.mainEntity;
  const listItems = Array.isArray(itemList?.itemListElement) ? itemList.itemListElement : [];
  const itemCount = itemList?.numberOfItems;
  if (!Number.isInteger(itemCount) || itemCount < 0) {
    errors.push("series ItemList numberOfItems must be a non-negative integer.");
  } else {
    if (itemCount !== listItems.length) {
      errors.push(`series ItemList declares ${itemCount} item(s) but contains ${listItems.length}.`);
    }
    const expectedAlt = `${document.h1[0] ?? ""}。全${itemCount}本の記事を順番に読めるNoemaのシリーズ`;
    if (document.openGraph.imageAlt !== expectedAlt) {
      errors.push(`series image alt is ${document.openGraph.imageAlt || "empty"}.`);
    }
  }

  const primaryImage = collection.primaryImageOfPage;
  if (!primaryImage || typeof primaryImage !== "object") {
    errors.push("series primaryImageOfPage JSON-LD is missing.");
  } else {
    if (primaryImage.url !== document.openGraph.image || primaryImage.contentUrl !== document.openGraph.image) {
      errors.push("series primaryImageOfPage must match og:image.");
    }
    if (primaryImage.width !== SERIES_OG_IMAGE_WIDTH || primaryImage.height !== SERIES_OG_IMAGE_HEIGHT) {
      errors.push(`series primaryImageOfPage must be ${SERIES_OG_IMAGE_WIDTH}x${SERIES_OG_IMAGE_HEIGHT}.`);
    }
  }

  return errors;
}

export function parsePngDimensions(body) {
  const bytes = Buffer.from(body);
  if (bytes.length < 33) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((value, index) => bytes[index] !== value)) return null;

  let dimensions;
  let foundImageData = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return null;
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const chunkEnd = crcOffset + 4;
    const type = bytes.toString("ascii", typeStart, dataStart);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(bytes.subarray(typeStart, crcOffset)) >>> 0;
    if (actualCrc !== expectedCrc) return null;

    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = {
        height: bytes.readUInt32BE(dataStart + 4),
        width: bytes.readUInt32BE(dataStart),
      };
      if (dimensions.width === 0 || dimensions.height === 0) return null;
    } else if (type === "IHDR") {
      return null;
    }

    if (type === "IDAT") foundImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !foundImageData || chunkEnd !== bytes.length) return null;
      return dimensions ?? null;
    }
    offset = chunkEnd;
  }
  return null;
}

export function validateOgImageAsset(imageUrl, headers, body) {
  const errors = [];
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) errors.push(`content-type is ${contentType || "empty"}.`);

  const url = new URL(imageUrl);
  if (!/^\/og\/series\/[a-z0-9-]+\.png$/u.test(url.pathname)) return errors;

  if (!contentType.toLowerCase().startsWith("image/png")) {
    errors.push(`series image content-type is ${contentType || "empty"}.`);
  }
  if ((headers.get("x-content-type-options") ?? "").toLowerCase() !== "nosniff") {
    errors.push("series image must set X-Content-Type-Options: nosniff.");
  }

  const cacheControl = (headers.get("cache-control") ?? "").toLowerCase();
  const cacheDirectives = new Set(cacheControl.split(",").map((value) => value.trim()).filter(Boolean));
  for (const directive of [
    "public",
    "max-age=3600",
    "s-maxage=604800",
    "stale-while-revalidate=86400",
  ]) {
    if (!cacheDirectives.has(directive)) errors.push(`series image cache-control is missing ${directive}.`);
  }
  if (cacheDirectives.has("no-store")) errors.push("series image must not use no-store fallback caching.");

  const dimensions = parsePngDimensions(body);
  if (!dimensions) {
    errors.push("series image is not a readable PNG.");
  } else if (dimensions.width !== SERIES_OG_IMAGE_WIDTH || dimensions.height !== SERIES_OG_IMAGE_HEIGHT) {
    errors.push(`series image is ${dimensions.width}x${dimensions.height}, expected ${SERIES_OG_IMAGE_WIDTH}x${SERIES_OG_IMAGE_HEIGHT}.`);
  }
  return errors;
}

export async function verifyPublicSeo(sourceOrigin, options = {}) {
  const canonicalOrigin = options.canonicalOrigin ?? CANONICAL_ORIGIN;
  const fetcher = options.fetcher ?? fetch;
  const normalizedSourceOrigin = new URL(sourceOrigin).origin;
  const sitemapResponse = await fetchOk(new URL("/sitemap.xml", normalizedSourceOrigin), fetcher);
  const sitemapContentType = sitemapResponse.headers.get("content-type") ?? "";
  if (!sitemapContentType.includes("xml")) throw new Error(`sitemap.xml returned ${sitemapContentType || "no content-type"}.`);
  const entries = parseSitemap(await sitemapResponse.text(), canonicalOrigin);
  const rssResponse = await fetchOk(new URL("/rss.xml", normalizedSourceOrigin), fetcher);
  const rssContentType = rssResponse.headers.get("content-type") ?? "";
  if (!rssContentType.includes("xml")) throw new Error(`rss.xml returned ${rssContentType || "no content-type"}.`);
  const rssFeed = parseRssFeed(await rssResponse.text());
  const rssErrors = validateRssFeed(rssFeed, entries, canonicalOrigin);
  if (rssErrors.length > 0) throw new Error(`Invalid RSS feed:\n${rssErrors.join("\n")}`);

  const pages = await mapWithConcurrency(entries, MAX_CONCURRENCY, async (entry) => {
    const canonicalUrl = new URL(entry.url);
    const sourceUrl = new URL(`${canonicalUrl.pathname}${canonicalUrl.search}`, normalizedSourceOrigin);
    const response = await fetchOk(sourceUrl, fetcher);
    const contentType = response.headers.get("content-type") ?? "";
    const errors = [];
    if (!contentType.includes("text/html")) errors.push(`content-type is ${contentType || "empty"}.`);
    const document = inspectSeoDocument(await response.text(), entry.url);
    errors.push(...validateSeoDocument(document, entry.url));
    return { document, errors, url: entry.url };
  });

  const titles = groupedDuplicates(pages, (page) => page.document.title);
  const descriptions = groupedDuplicates(pages, (page) => page.document.description);
  const errors = pages.flatMap((page) => page.errors.map((error) => `${page.url}: ${error}`));
  for (const duplicate of titles) errors.push(`Duplicate title on ${duplicate.urls.join(", ")}: ${duplicate.value}`);
  for (const duplicate of descriptions) errors.push(`Duplicate description on ${duplicate.urls.join(", ")}: ${duplicate.value}`);
  if (errors.length > 0) throw new Error(`Public SEO verification failed:\n${errors.join("\n")}`);

  const ogImages = [...new Set(pages.map((page) => page.document.openGraph.image))];
  const imageResults = await mapWithConcurrency(ogImages, MAX_CONCURRENCY, async (imageUrl) => {
    const canonicalImage = new URL(imageUrl);
    const sourceImage = new URL(`${canonicalImage.pathname}${canonicalImage.search}`, normalizedSourceOrigin);
    const response = await fetchOk(sourceImage, fetcher);
    const body = await response.arrayBuffer();
    return validateOgImageAsset(imageUrl, response.headers, body)
      .map((error) => `${imageUrl}: ${error}`);
  });
  const imageErrors = imageResults.flat();
  if (imageErrors.length > 0) throw new Error(`Public OG image verification failed:\n${imageErrors.join("\n")}`);

  console.log(`Verified SEO metadata for ${pages.length} sitemap URL(s), ${ogImages.length} OG image(s), and ${rssFeed.items.length} canonical RSS item(s).`);
  return { ogImageCount: ogImages.length, pageCount: pages.length, rssItemCount: rssFeed.items.length };
}

function parseAttributes(source) {
  const attributes = {};
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match.groups.name.toLowerCase();
    attributes[name] = decodeEntities(match.groups.double ?? match.groups.single ?? match.groups.bare ?? "");
  }
  return attributes;
}

function relValues(value = "") {
  return value.toLowerCase().split(/\s+/u).filter(Boolean);
}

function elementText(source, element) {
  return source.match(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}>`, "iu"))?.[1]?.trim() ?? "";
}

function textContent(source) {
  return decodeEntities(source.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function collectSchemaTypes(value, types) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, types);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schemaType = value["@type"];
  if (typeof schemaType === "string") types.add(schemaType);
  if (Array.isArray(schemaType)) for (const item of schemaType) if (typeof item === "string") types.add(item);
  for (const item of Object.values(value)) collectSchemaTypes(item, types);
}

function collectSchemaNodes(value, type, nodes) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaNodes(item, type, nodes);
    return;
  }
  if (!value || typeof value !== "object") return;
  const schemaTypes = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (schemaTypes.includes(type)) nodes.push(value);
  for (const item of Object.values(value)) collectSchemaNodes(item, type, nodes);
}

function requiredSchemaTypes(pathname) {
  if (pathname === "/") return ["Organization", "WebSite"];
  if (/^\/articles\/[a-z0-9-]+$/u.test(pathname)) return ["BlogPosting", "BreadcrumbList"];
  if (/^\/editors\//u.test(pathname)) return ["ProfilePage", "Person", "BreadcrumbList"];
  if (pathname === "/articles" || pathname === "/series" || /^\/(?:series|topics)\//u.test(pathname)) {
    return ["CollectionPage", "ItemList", "BreadcrumbList"];
  }
  return ["BreadcrumbList"];
}

function groupedDuplicates(values, select) {
  const groups = new Map();
  for (const value of values) {
    const key = select(value);
    const urls = groups.get(key) ?? [];
    urls.push(value.url);
    groups.set(key, urls);
  }
  return [...groups.entries()]
    .filter(([key, urls]) => key && urls.length > 1)
    .map(([value, urls]) => ({ urls, value }));
}

async function fetchOk(url, fetcher) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetcher(url, {
        headers: { "user-agent": "Noema deployment SEO verifier" },
        redirect: "error",
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
  const sourceOrigin = process.argv[2] ?? process.env.NOEMA_PUBLIC_SEO_ORIGIN ?? CANONICAL_ORIGIN;
  await verifyPublicSeo(sourceOrigin);
}
