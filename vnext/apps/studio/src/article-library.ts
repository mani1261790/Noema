import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsVisibilityLabels,
  type CmsArticleSummary,
  type CmsRole
} from "@noema/cms";

export type CmsArticleFilter =
  | "all"
  | "archived"
  | "changes_requested"
  | "draft"
  | "in_review"
  | "published"
  | "ready_to_publish"
  | "review";

export interface CmsEditorialQueueItem {
  count: number;
  description: string;
  filter: CmsArticleFilter;
  label: string;
}

export const cmsArticleFilterOptions: ReadonlyArray<{
  label: string;
  value: CmsArticleFilter;
}> = [
  { label: "すべて", value: "all" },
  { label: "公開中", value: "published" },
  { label: "下書き・要修正", value: "draft" },
  { label: "レビュー・承認", value: "review" },
  { label: "保管", value: "archived" }
];

function normalizeArticleSearchValue(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

function matchesArticleFilter(article: CmsArticleSummary, filter: CmsArticleFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return ["draft", "changes_requested"].includes(article.reviewStatus);
    case "changes_requested":
      return article.reviewStatus === "changes_requested";
    case "in_review":
      return article.reviewStatus === "in_review";
    case "review":
      return ["in_review", "approved"].includes(article.reviewStatus);
    case "ready_to_publish":
      return article.reviewStatus === "approved" && article.publicationStatus === "unpublished";
    case "published":
      return article.publicationStatus === "published";
    case "archived":
      return article.publicationStatus === "archived";
  }
}

export function getCmsEditorialQueue(
  articles: readonly CmsArticleSummary[],
  role: CmsRole
): CmsEditorialQueueItem[] {
  if (role === "editor") {
    return [{
      count: articles.filter((article) => article.reviewStatus === "changes_requested").length,
      description: "レビューコメントを確認して、本文を直す記事です。",
      filter: "changes_requested",
      label: "修正する記事"
    }];
  }

  const reviewCount = articles.filter((article) => article.reviewStatus === "in_review").length;
  const queue: CmsEditorialQueueItem[] = [{
    count: reviewCount,
    description: "内容を確認し、承認または修正依頼を返す記事です。",
    filter: "in_review",
    label: "レビューする記事"
  }];

  if (role === "admin") {
    queue.push({
      count: articles.filter((article) => (
        article.reviewStatus === "approved" && article.publicationStatus === "unpublished"
      )).length,
      description: "承認済みで、公開操作を待っている記事です。",
      filter: "ready_to_publish",
      label: "公開する記事"
    });
  }
  return queue;
}

export function filterCmsArticles(
  articles: readonly CmsArticleSummary[],
  query: string,
  filter: CmsArticleFilter,
  searchAliases: ReadonlyMap<string, string> = new Map()
): CmsArticleSummary[] {
  const normalizedQuery = normalizeArticleSearchValue(query);
  return articles.filter((article) => {
    if (!matchesArticleFilter(article, filter)) return false;
    if (!normalizedQuery) return true;
    const searchableText = normalizeArticleSearchValue([
      article.title,
      article.slug,
      article.updatedByEmail,
      cmsReviewStatusLabels[article.reviewStatus],
      cmsPublicationStatusLabels[article.publicationStatus],
      cmsVisibilityLabels[article.visibility],
      searchAliases.get(article.id) ?? ""
    ].join(" "));
    return searchableText.includes(normalizedQuery);
  });
}
