import type { RSSFeedItem } from "@astrojs/rss";
import type { ArticleSummary } from "@noema/content";

const DEFAULT_SITE = new URL("https://noema-learn.uk");

export function createNoemaRssItems(
  articles: readonly ArticleSummary[],
  site: URL = DEFAULT_SITE,
): RSSFeedItem[] {
  return [...articles]
    .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
    .map((article) => ({
      title: article.title,
      description: article.description,
      pubDate: new Date(`${article.publishedAt ?? article.updatedAt}T00:00:00Z`),
      link: new URL(`/articles/${article.slug}`, site).toString(),
      categories: article.tags,
    }));
}
