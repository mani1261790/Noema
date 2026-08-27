export type ArticleSearchDocument = {
  description: string;
  excerpt: string;
  seriesTitle?: string;
  tags: readonly string[];
  title: string;
  topicLabels: readonly string[];
};

export function normalizeArticleSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildArticleSearchText(document: ArticleSearchDocument): string {
  return normalizeArticleSearchText([
    document.title,
    document.description,
    document.excerpt,
    document.seriesTitle,
    ...document.topicLabels,
    ...document.tags,
  ].filter((value): value is string => Boolean(value?.trim())).join(" "));
}
