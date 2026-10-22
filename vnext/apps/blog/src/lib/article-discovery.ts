import { topicLabels, type ArticleSummary } from "@noema/content";
import { sortArticlesByDate } from "./articles";

export const readingIntents = {
  explore: { label: "しくみを知る", description: "身近な疑問から、AIの内側へ。", approaches: ["theory"] },
  try: { label: "使ってみる", description: "道具を触って、できることを広げる。", approaches: ["experience", "practice"] },
  build: { label: "つくってみる", description: "コードや画面を、自分の手で形にする。", approaches: ["development"] },
} as const;
export type ReadingIntent = keyof typeof readingIntents;

export function articleIntent(article: Pick<ArticleSummary, "approach">): ReadingIntent {
  return article.approach === "theory" ? "explore" : article.approach === "development" ? "build" : "try";
}

interface Series { items: ReadonlyArray<Pick<ArticleSummary, "slug">> }
export function isContinuationTitle(title: string): boolean {
  return /[②-⑳]/u.test(title) || /(?:第\s*(?:[2-9]|\d{2,})\s*(?:回|章|部)|part\s*(?:[2-9]|\d{2,})\b|その\s*(?:[2-9]|\d{2,})(?!\d)|\((?:[2-9]|\d{2,})\)|後編|続編)/iu.test(title.normalize("NFKC"));
}

/** Entry choices are diverse, public, and not a later part of a published series. */
export function selectEntryArticles<T extends ArticleSummary>(articles: readonly T[], series: readonly Series[], limit = 3): T[] {
  const laterParts = new Set(series.flatMap((item) => item.items.slice(1).map((article) => article.slug)));
  const eligible = sortArticlesByDate(articles).filter((article) => !laterParts.has(article.slug) && !isContinuationTitle(article.title));
  const selected: T[] = [];
  for (const intent of ["try", "explore", "build"] as const) {
    const candidates = eligible.filter((article) => articleIntent(article) === intent);
    // Prefer an explicit opening/overview when present, never infer "easy" from topic.
    const entry = candidates.find((article) => /はじめ|最初|基本|とは|入門/u.test(article.title)) ?? candidates[0];
    if (entry && selected.length < limit) selected.push(entry);
  }
  for (const article of eligible) {
    if (selected.length >= limit) break;
    if (!selected.some((item) => item.slug === article.slug)) selected.push(article);
  }
  return selected;
}

export function relatedReadingReason(current: ArticleSummary, candidate: ArticleSummary): string {
  const tag = candidate.tags.find((value) => !["ai", "初学者", "初心者", "入門", "基本", "基礎"].includes(value.normalize("NFKC").toLowerCase()) && current.tags.some((currentTag) => currentTag.toLowerCase() === value.toLowerCase()));
  const topic = candidate.topics.find((value) => current.topics.includes(value));
  const subject = tag ?? (topic ? topicLabels[topic] : "このテーマ");
  const activity = articleIntent(candidate);
  if (articleIntent(current) !== activity) return `${subject}に関連：${readingIntents[activity].label}`;
  return `${subject}について、あわせて読む`;
}

