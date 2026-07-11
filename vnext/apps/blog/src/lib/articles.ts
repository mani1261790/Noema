import type { ArticleSummary } from "@noema/content";

export function formatJapaneseDate(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00Z`));
}

export function sortArticlesByDate<T extends ArticleSummary>(articles: T[]): T[] {
  return [...articles].sort((a, b) =>
    (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt)
  );
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
