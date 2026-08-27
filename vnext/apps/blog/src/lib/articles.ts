import type { ArticleFrontmatter, ArticleSummary } from "@noema/content";

export function toArticleSummary(data: ArticleFrontmatter): ArticleSummary {
  return {
    ...data,
    excerpt: data.description,
    href: `/articles/${data.slug}`
  };
}

export function formatJapaneseDate(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export function sortArticlesByDate<T extends ArticleSummary>(articles: readonly T[]): T[] {
  return [...articles].sort((a, b) =>
    (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt)
  );
}

interface ArticleSeries {
  items: ReadonlyArray<Pick<ArticleSummary, "slug">>;
}

export function selectStandaloneArticles<T extends ArticleSummary>(
  articles: readonly T[],
  seriesList: readonly ArticleSeries[],
  limit = 3,
): T[] {
  const seriesArticleSlugs = new Set(
    seriesList.flatMap((series) => series.items.map((article) => article.slug))
  );

  return sortArticlesByDate(
    articles.filter((article) => !seriesArticleSlugs.has(article.slug))
  ).slice(0, Math.max(0, Math.floor(limit)));
}

export function findRelatedArticles<T extends ArticleSummary>(
  current: ArticleSummary,
  candidates: T[],
  limit = 3
): T[] {
  const currentTopics = new Set(current.topics);
  const currentTags = new Set(current.tags);

  return candidates
    .filter((candidate) => candidate.slug !== current.slug)
    .map((candidate) => ({
      candidate,
      score:
        candidate.topics.filter((topic) => currentTopics.has(topic)).length * 4 +
        candidate.tags.filter((tag) => currentTags.has(tag)).length * 2 +
        (candidate.approach !== current.approach ? 1 : 0)
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.publishedAt ?? "").localeCompare(a.candidate.publishedAt ?? ""))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
