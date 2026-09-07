import {
  cmsPublicationStatusLabels,
  cmsReviewStatusLabels,
  cmsVisibilityLabels,
  type CmsArticleSummary,
  type CmsSeries
} from "@noema/cms";

export type CmsArticleStatus = "draft" | "in_review" | "approved" | "published";
export type CmsArticleSort = "updated" | "title";

export interface CmsArticleFilter {
  statuses: readonly CmsArticleStatus[];
  includeArchived: boolean;
}

export const cmsArticleStatusOptions: ReadonlyArray<{ label: string; value: CmsArticleStatus }> = [
  { label: "下書き", value: "draft" },
  { label: "レビュー中", value: "in_review" },
  { label: "承認済み", value: "approved" },
  { label: "公開", value: "published" }
];

export const cmsAllArticleFilter: CmsArticleFilter = {
  statuses: cmsArticleStatusOptions.map(({ value }) => value),
  includeArchived: true
};
export const cmsUnpublishedArticleFilter: CmsArticleFilter = {
  statuses: ["draft", "in_review", "approved"],
  includeArchived: false
};

// A live article remains published even while its next revision is being edited.
export function getCmsArticleStatus(article: CmsArticleSummary): CmsArticleStatus {
  if (article.publicationStatus === "published") return "published";
  return article.reviewStatus === "changes_requested" ? "draft" : article.reviewStatus;
}

function normalizeArticleSearchValue(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

export function filterCmsArticles(
  articles: readonly CmsArticleSummary[],
  query: string,
  filter: CmsArticleFilter,
  searchAliases: ReadonlyMap<string, string> = new Map()
): CmsArticleSummary[] {
  const normalizedQuery = normalizeArticleSearchValue(query);
  return articles.filter((article) => {
    if (!filter.includeArchived && article.publicationStatus === "archived") return false;
    if (!filter.statuses.includes(getCmsArticleStatus(article))) return false;
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

const articleNameCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function sortCmsArticles(articles: readonly CmsArticleSummary[], sort: CmsArticleSort): CmsArticleSummary[] {
  return [...articles].sort((a, b) => {
    const byTitle = articleNameCollator.compare(a.title.trim() || "無題の記事", b.title.trim() || "無題の記事");
    const byUpdated = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    return (sort === "title" ? byTitle || byUpdated : byUpdated || byTitle) || a.id.localeCompare(b.id);
  });
}

export interface CmsArticleGroup {
  id: string;
  title: string;
  articles: CmsArticleSummary[];
  total: number;
}

export function groupCmsArticles(
  articles: readonly CmsArticleSummary[],
  series: readonly CmsSeries[],
  sort: CmsArticleSort
): { groups: CmsArticleGroup[]; standalone: CmsArticleSummary[] } {
  const memberships = new Map<string, string>();
  for (const item of series) for (const id of item.articleIds) memberships.set(id, item.id);
  const byId = new Map(articles.map((article) => [article.id, article]));
  const groups = series.flatMap((item) => {
    // Series order expresses the reading sequence, independent of the group sort.
    const members = item.articleIds.flatMap((id) => {
      const article = byId.get(id);
      return article && memberships.get(id) === item.id ? [article] : [];
    });
    return members.length ? [{ id: item.id, title: item.title, articles: members, total: item.articleIds.length }] : [];
  });
  const updatedAt = (group: CmsArticleGroup) => Math.max(...group.articles.map((article) => Date.parse(article.updatedAt) || 0));
  groups.sort((a, b) => {
    const byTitle = articleNameCollator.compare(a.title, b.title);
    return (sort === "title" ? byTitle : updatedAt(b) - updatedAt(a) || byTitle) || a.id.localeCompare(b.id);
  });
  return { groups, standalone: sortCmsArticles(articles.filter((article) => !memberships.has(article.id)), sort) };
}
