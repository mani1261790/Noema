import { normalizeArticleSearchValue } from "@noema/content";

export type ArticleSearchDocument = {
  authors: readonly string[];
  description: string;
  editorName?: string;
  excerpt: string;
  seriesTitle?: string;
  slug: string;
  tags: readonly string[];
  title: string;
  topicLabels: readonly string[];
};

export const normalizeArticleSearchText = normalizeArticleSearchValue;

export function buildArticleSearchText(document: ArticleSearchDocument): string {
  return normalizeArticleSearchText([
    document.title,
    document.slug,
    document.description,
    document.excerpt,
    document.editorName,
    ...document.authors,
    document.seriesTitle,
    ...document.topicLabels,
    ...document.tags,
  ].filter((value): value is string => Boolean(value?.trim())).join(" "));
}
