import type { CmsArticleDetail } from "@noema/cms";

type ArticleDeletionState = Pick<
  CmsArticleDetail,
  "publicationStatus" | "publishedRevisionNumber" | "reviewStatus"
>;

export function canDeleteCmsDraftArticle(
  article: ArticleDeletionState | null,
  canEdit: boolean
): boolean {
  return Boolean(
    canEdit &&
    article?.reviewStatus === "draft" &&
    article.publicationStatus === "unpublished" &&
    article.publishedRevisionNumber === null
  );
}
