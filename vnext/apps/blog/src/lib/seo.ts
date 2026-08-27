export type JsonLd = Record<string, unknown>;

export interface BreadcrumbItem {
  href?: string;
  label: string;
}

export interface SitemapEntry {
  lastModified?: string;
  pathname: string;
}

export interface ArticleStructuredDataInput {
  authors: ReadonlyArray<{ name: string; url?: string }>;
  description: string;
  headline: string;
  image?: string | {
    height?: number;
    src: string;
    width?: number;
  };
  pathname: string;
  publishedAt: string;
  updatedAt: string;
}

export interface OpenGraphImageDimensionsInput {
  hasCustomImage: boolean;
  height?: number;
  width?: number;
}

export interface CollectionPageStructuredDataInput {
  description: string;
  items: ReadonlyArray<{
    name: string;
    pathname: string;
  }>;
  name: string;
  pathname: string;
}

const fallbackSite = new URL("https://noema-learn.uk");
const organizationLogoPath = "/images/brand/noema-logo-512.png";
const siteName = "Noema";
const siteAlternateName = "noema-learn.uk";

export function canonicalPathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/u, "") || "/";
}

export function canonicalUrl(pathname: string, site: URL = fallbackSite): URL {
  const url = new URL(pathname, site);
  url.pathname = canonicalPathname(url.pathname);
  url.search = "";
  url.hash = "";
  return url;
}

export function serializeJsonLd(value: JsonLd): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function resolveOpenGraphImageDimensions(
  input: OpenGraphImageDimensionsInput,
): { height: number; width: number } | null {
  if (!input.hasCustomImage) return { height: 630, width: 1200 };
  if (
    !Number.isInteger(input.width) || !Number.isInteger(input.height) ||
    (input.width ?? 0) <= 0 || (input.height ?? 0) <= 0
  ) return null;
  return { height: input.height as number, width: input.width as number };
}

export function breadcrumbJsonLd(
  items: readonly BreadcrumbItem[],
  currentPathname: string,
  site: URL = fallbackSite,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: canonicalUrl(item.href ?? currentPathname, site).toString(),
    })),
  };
}

export function organizationJsonLd(site: URL = fallbackSite): JsonLd {
  const siteUrl = canonicalUrl("/", site).toString();
  const logoUrl = new URL(organizationLogoPath, site).toString();

  return {
    "@id": `${siteUrl}#organization`,
    "@type": "Organization",
    name: siteName,
    url: siteUrl,
    logo: {
      "@type": "ImageObject",
      url: logoUrl,
      contentUrl: logoUrl,
      width: 512,
      height: 512,
    },
  };
}

export function websiteJsonLd(site: URL = fallbackSite): JsonLd {
  const siteUrl = canonicalUrl("/", site).toString();

  return {
    "@id": `${siteUrl}#website`,
    "@type": "WebSite",
    name: siteName,
    alternateName: siteAlternateName,
    url: siteUrl,
  };
}

export function articleJsonLd(
  article: ArticleStructuredDataInput,
  site: URL = fallbackSite,
): JsonLd {
  const articleUrl = canonicalUrl(article.pathname, site).toString();
  const image = typeof article.image === "string"
    ? [new URL(article.image, site).toString()]
    : article.image
      ? [articleImageJsonLd(article.image, site)]
      : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.headline,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    inLanguage: "ja",
    mainEntityOfPage: articleUrl,
    ...(image ? { image } : {}),
    author: article.authors.map((author) => ({
      "@type": "Person",
      name: author.name,
      ...(author.url ? { url: canonicalUrl(author.url, site).toString() } : {}),
    })),
    publisher: organizationJsonLd(site),
    isPartOf: websiteJsonLd(site),
  };
}

function articleImageJsonLd(
  image: Exclude<ArticleStructuredDataInput["image"], string | undefined>,
  site: URL,
): JsonLd | string {
  const url = new URL(image.src, site).toString();
  if (
    !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
    (image.width ?? 0) <= 0 || (image.height ?? 0) <= 0
  ) return url;
  return {
    "@type": "ImageObject",
    contentUrl: url,
    height: image.height,
    url,
    width: image.width,
  };
}

export function collectionPageJsonLd(
  collection: CollectionPageStructuredDataInput,
  site: URL = fallbackSite,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.name,
    description: collection.description,
    url: canonicalUrl(collection.pathname, site).toString(),
    inLanguage: "ja",
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: collection.items.length,
      itemListElement: collection.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: canonicalUrl(item.pathname, site).toString(),
      })),
    },
  };
}

export function serializeSitemap(
  entries: readonly SitemapEntry[],
  site: URL = fallbackSite,
): string {
  const urls = entries.map((entry) => {
    const location = escapeXml(canonicalUrl(entry.pathname, site).toString());
    const lastModified = entry.lastModified
      ? `<lastmod>${escapeXml(entry.lastModified)}</lastmod>`
      : "";
    return `  <url><loc>${location}</loc>${lastModified}</url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
