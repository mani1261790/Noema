import type { ArticlePreview } from "@noema/content";

export type ArticleLevelTone = "experience" | "practice" | "development" | "theory";

export function getArticleLevelTone(article: ArticlePreview): ArticleLevelTone {
  if (article.stage === "experience") return "experience";
  if (article.stage === "practice") return "practice";
  return article.track === "development" ? "development" : "theory";
}
