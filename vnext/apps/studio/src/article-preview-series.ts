import type { CmsSeries } from "@noema/cms";
import type { ArticlePresentationSeries } from "@noema/content/article-presentation";

export function buildArticlePreviewSeries(
  articleId: string | null,
  currentTitle: string,
  series: CmsSeries[],
): ArticlePresentationSeries | null {
  if (!articleId) return null;
  const membership = series.find((item) => item.articleIds.includes(articleId));
  if (!membership) return null;
  const currentIndex = membership.articleIds.indexOf(articleId);
  return {
    currentIndex,
    description: membership.description,
    href: `/series/${membership.slug}`,
    items: membership.articles.map((item, index) => ({
      href: `/articles/${item.slug}/`,
      title: index === currentIndex && currentTitle ? currentTitle : item.title,
    })),
    title: membership.title,
  };
}
