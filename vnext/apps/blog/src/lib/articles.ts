import { detectArticleFeatures } from "@noema/content/article-features";
import type { ArticleFrontmatter, ArticleSummary } from "@noema/content";

export function toArticleSummary(data: ArticleFrontmatter, markdown?: string): ArticleSummary {
  return {
    ...data,
    excerpt: data.description,
    ...(markdown !== undefined ? { features: detectArticleFeatures(markdown, data.title, data.description) } : {}),
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
  const normalizeTag = (tag: string) => tag.normalize("NFKC").toLowerCase();
  const genericTags = new Set(["ai", "初学者", "初心者", "入門", "基本", "基礎"]);
  const currentTags = new Set(current.tags.map(normalizeTag).filter(tag => !genericTags.has(tag)));

  return candidates
    .filter((candidate) => candidate.slug !== current.slug)
    .map((candidate) => {
      const sharedTopicCount = candidate.topics.filter((topic) => currentTopics.has(topic)).length;
      const sharedTagCount = candidate.tags.filter((tag) => currentTags.has(normalizeTag(tag))).length;
      // One topic is a broad shelf; a shared tag or two shared topics indicate a useful next read.
      const hasMeaningfulRelationship = sharedTagCount > 0 || sharedTopicCount > 1;

      return {
        candidate,
        score: hasMeaningfulRelationship
          ? sharedTopicCount * 4 +
            sharedTagCount * 2 +
            (candidate.approach !== current.approach ? 1 : 0)
          : 0
      };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.candidate.publishedAt ?? "").localeCompare(a.candidate.publishedAt ?? ""))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
