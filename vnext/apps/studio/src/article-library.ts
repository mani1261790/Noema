import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsVisibilityLabels,
  type CmsArticleSummary
} from "@noema/cms";

export type CmsArticleFilter = "all" | "draft" | "review" | "published" | "archived";

export const cmsArticleFilterOptions: ReadonlyArray<{
  label: string;
  value: CmsArticleFilter;
}> = [
  { label: "すべて", value: "all" },
  { label: "下書き・要修正", value: "draft" },
  { label: "レビュー・承認", value: "review" },
  { label: "公開中", value: "published" },
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
    case "review":
      return ["in_review", "approved"].includes(article.reviewStatus);
    case "published":
      return article.publicationStatus === "published";
    case "archived":
      return article.publicationStatus === "archived";
  }
}

export function filterCmsArticles(
  articles: readonly CmsArticleSummary[],
  query: string,
  filter: CmsArticleFilter
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
      cmsVisibilityLabels[article.visibility]
    ].join(" "));
    return searchableText.includes(normalizedQuery);
  });
}
