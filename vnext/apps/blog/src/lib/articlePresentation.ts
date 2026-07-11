import type { ArticleSummary } from "@noema/content";

export type ArticleApproachTone = "experience" | "practice" | "development" | "theory";

export function getArticleApproachTone(article: ArticleSummary): ArticleApproachTone {
  return article.approach;
}
