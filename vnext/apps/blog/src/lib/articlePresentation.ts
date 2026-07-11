import type { ArticlePreview } from "@noema/content";

export type ArticleApproachTone = "experience" | "practice" | "development" | "theory";

export function getArticleApproachTone(article: ArticlePreview): ArticleApproachTone {
  return article.approach;
}
