import type { CmsReviewStatus } from "@noema/cms";

export type ArticleEditorSurface = {
  mode: "publish" | "review";
  previewOnly: boolean;
};

export function resolveLockedArticleSurface(
  canPublish: boolean,
  reviewStatus: CmsReviewStatus
): { mode: "publish" | "review"; previewOnly: true } {
  return {
    mode: canPublish && reviewStatus === "approved" ? "publish" : "review",
    previewOnly: true
  };
}

export function resolveArticleOpeningSurface(
  canEdit: boolean,
  canPublish: boolean,
  reviewStatus: CmsReviewStatus
): ArticleEditorSurface | null {
  if (canEdit && reviewStatus === "changes_requested") {
    return { mode: "review", previewOnly: false };
  }
  if (!canEdit || ["in_review", "approved"].includes(reviewStatus)) {
    return resolveLockedArticleSurface(canPublish, reviewStatus);
  }
  return null;
}

export function resolveReviewCommentFocusSurface(
  canEdit: boolean,
  reviewStatus: CmsReviewStatus
): "markdown" | "preview" {
  return canEdit && ["draft", "changes_requested"].includes(reviewStatus)
    ? "markdown"
    : "preview";
}
