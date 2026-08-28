import type { ArticleSummary } from "@noema/content";
import type { CmsPublishedEditorListing, CmsPublishedSeries } from "./cms-publication-repository";
import type { SitemapEntry } from "./seo";
import { listNarrowingTopics } from "./topics";

type StaticPageLastModified = Readonly<Record<"/about" | "/privacy" | "/updates", string>>;

export interface SitemapContent {
  articles: ArticleSummary[];
  editors: CmsPublishedEditorListing[];
  seriesList: CmsPublishedSeries[];
  staticPageLastModified: StaticPageLastModified;
}

const articleLastModified = (article: ArticleSummary) =>
  [article.publishedAt, article.updatedAt]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

const latestArticleDate = (articles: ArticleSummary[]) =>
  articles
    .map(articleLastModified)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

export function buildSitemapEntries({
  articles,
  editors,
  seriesList,
  staticPageLastModified,
}: SitemapContent): SitemapEntry[] {
  const latestPublicArticleDate = latestArticleDate(articles);
  const latestSeriesDate = seriesList.map((series) => series.updatedAt).sort().at(-1);
  const latestSiteDate = [latestPublicArticleDate, latestSeriesDate]
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);

  return [
    { pathname: "/", lastModified: latestSiteDate },
    { pathname: "/articles", lastModified: latestSiteDate },
    { pathname: "/series", lastModified: latestSeriesDate },
    { pathname: "/updates", lastModified: staticPageLastModified["/updates"] },
    { pathname: "/about", lastModified: staticPageLastModified["/about"] },
    { pathname: "/privacy", lastModified: staticPageLastModified["/privacy"] },
    ...listNarrowingTopics(articles)
      .map(({ slug }) => ({
        pathname: `/topics/${slug}`,
        lastModified: latestArticleDate(articles.filter((article) =>
          article.topics.includes(slug)
        )),
      })),
    ...seriesList.map((series) => ({
      pathname: series.href,
      lastModified: [series.updatedAt, latestArticleDate(series.items)]
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1),
    })),
    ...articles.map((article) => ({
      pathname: `/articles/${article.slug}`,
      lastModified: articleLastModified(article),
    })),
    ...editors.map((editor) => ({
      pathname: editor.href,
      lastModified: editor.updatedAt,
    })),
  ];
}
