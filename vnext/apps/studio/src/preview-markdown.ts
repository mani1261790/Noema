import { createArticleMarkdownRenderer } from "@noema/content/article-renderer";
import type MarkdownIt from "markdown-it";

export function resolvePublicSiteReference(reference: string, publicSiteUrl: string): string {
  const value = reference.trim();

  if (!value.startsWith("/") || value.startsWith("//")) return reference;

  try {
    return new URL(value, publicSiteUrl).href;
  } catch {
    return reference;
  }
}

export function resolvePreviewImageReference(reference: string, publicSiteUrl: string): string {
  if (reference.startsWith("/media/articles/")) {
    return `/api/cms/assets/${reference.slice("/media/".length)}`;
  }
  return resolvePublicSiteReference(reference, publicSiteUrl);
}

export function createPreviewMarkdown(publicSiteUrl: string): MarkdownIt {
  return createArticleMarkdownRenderer({
    externalLinksInNewTab: true,
    resolveImageReference: (reference) => resolvePreviewImageReference(reference, publicSiteUrl),
    resolveLinkReference: (reference) => resolvePublicSiteReference(reference, publicSiteUrl),
  });
}

export { renderArticleMarkdownWith } from "@noema/content/article-renderer";
