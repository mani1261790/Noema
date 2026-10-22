export type ArticleSearchDocument = {
  authors?: readonly string[];
  editorDisplayName?: string;
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
    ...(document.authors ?? []),
    document.editorDisplayName,
    document.description,
    document.excerpt,
    document.seriesTitle,
    ...document.topicLabels,
    ...document.tags,
  ].filter((value): value is string => Boolean(value?.trim())).join(" "));
}

export function scoreArticleSearch(text: string, query: string, title = ""): number {
  const terms = normalizeArticleSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return 1;
  const normalized = normalizeArticleSearchText(text);
  if (!terms.every((term) => normalized.includes(term))) return 0;
  const heading = normalizeArticleSearchText(title);
  return 1 + terms.reduce((score, term) => score + (heading.includes(term) ? 4 : 0), 0)
    + (heading.includes(normalizeArticleSearchText(query)) ? 4 : 0);
}

export interface SearchableArticle {
  slug: string;
  title: string;
  text: string;
  series: string;
  topics: string[];
  tags: string[];
  features: string[];
  intent: string;
  publishedAt: string;
  updatedAt: string;
}
export function searchArticles<T extends SearchableArticle>(items: readonly T[], params: URLSearchParams): T[] {
  const query = params.get("keyword") ?? "";
  const features = params.getAll("feature");
  const series = params.get("series");
  const topic = params.get("topic");
  const tag = params.get("tag");
  const intent = params.get("intent");
  const sort = params.get("sort") ?? (query ? "relevance" : "published");
  return items.map((item) => ({ item, score: scoreArticleSearch(item.text, query, item.title) }))
    .filter(({ item, score }) => score > 0 && (!series || item.series === series)
      && (!topic || item.topics.includes(topic)) && (!tag || item.tags.includes(tag))
      && (!intent || item.intent === intent) && features.every((feature) => item.features.includes(feature)))
    .sort((a, b) => (sort === "relevance" ? b.score - a.score : 0)
      || (sort === "updated" ? b.item.updatedAt.localeCompare(a.item.updatedAt) : b.item.publishedAt.localeCompare(a.item.publishedAt))
      || a.item.slug.localeCompare(b.item.slug))
    .map(({ item }) => item);
}
