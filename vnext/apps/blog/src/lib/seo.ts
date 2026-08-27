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
  image?: string;
  pathname: string;
  publishedAt: string;
  updatedAt: string;
}

const fallbackSite = new URL("https://noema-learn.uk");
const organizationLogoPath = "/images/brand/noema-logo-512.png";

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
    name: "Noema",
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

export function articleJsonLd(
  article: ArticleStructuredDataInput,
  site: URL = fallbackSite,
): JsonLd {
  const articleUrl = canonicalUrl(article.pathname, site).toString();
  const siteUrl = canonicalUrl("/", site).toString();

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.headline,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt,
    inLanguage: "ja",
    mainEntityOfPage: articleUrl,
    ...(article.image ? { image: [new URL(article.image, site).toString()] } : {}),
    author: article.authors.map((author) => ({
      "@type": "Person",
      name: author.name,
      ...(author.url ? { url: canonicalUrl(author.url, site).toString() } : {}),
    })),
    publisher: organizationJsonLd(site),
    isPartOf: {
      "@id": `${siteUrl}#website`,
      "@type": "WebSite",
      name: "Noema",
      url: siteUrl,
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
