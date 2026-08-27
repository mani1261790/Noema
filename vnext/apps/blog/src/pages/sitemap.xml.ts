import type { APIRoute } from "astro";
import { topicLabels } from "@noema/content";
import { listPublicArticleSummaries, listPublishedEditors, listPublishedSeries } from "../lib/cms-publications";
import { serializeSitemap, type SitemapEntry } from "../lib/seo";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://noema-learn.uk");
  const [articles, editors, seriesList] = await Promise.all([
    listPublicArticleSummaries(),
    listPublishedEditors(),
    listPublishedSeries()
  ]);
  const publicTopics = new Set(articles.flatMap((article) => article.topics));
  const articleLastModified = (article: (typeof articles)[number]) =>
    [article.publishedAt, article.updatedAt].filter((date): date is string => Boolean(date)).sort().at(-1);
  const latestArticleDate = (items: typeof articles) =>
    items.map(articleLastModified).filter((date): date is string => Boolean(date)).sort().at(-1);
  const latestPublicArticleDate = latestArticleDate(articles);
  const latestSeriesDate = seriesList.map((series) => series.updatedAt).sort().at(-1);
  const latestSiteDate = [latestPublicArticleDate, latestSeriesDate]
    .filter((date): date is string => Boolean(date)).sort().at(-1);
  const entries: SitemapEntry[] = [
    { pathname: "/", lastModified: latestSiteDate },
    { pathname: "/articles", lastModified: latestSiteDate },
    { pathname: "/series", lastModified: latestSeriesDate },
    { pathname: "/updates" },
    { pathname: "/about" },
    { pathname: "/privacy" },
    ...Object.keys(topicLabels)
      .filter((topicSlug) => publicTopics.has(topicSlug as keyof typeof topicLabels))
      .map((topicSlug) => ({
        pathname: `/topics/${topicSlug}`,
        lastModified: latestArticleDate(articles.filter((article) =>
          article.topics.includes(topicSlug as keyof typeof topicLabels)
        ))
      })),
    ...seriesList.map((series) => ({
      pathname: series.href,
      lastModified: [series.updatedAt, latestArticleDate(series.items)]
        .filter((date): date is string => Boolean(date)).sort().at(-1)
    })),
    ...articles.map((article) => ({
      pathname: `/articles/${article.slug}`,
      lastModified: articleLastModified(article)
    })),
    ...editors.map((editor) => ({ pathname: editor.href }))
  ];

  return new Response(serializeSitemap(entries, base), {
    headers: { "content-type": "application/xml; charset=utf-8" }
  });
};
