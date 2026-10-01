import type { CmsReviewStatus } from "@noema/cms";

export type ArticleEditorSurface = {
  mode: "publish" | "review";
  panelOpen: boolean;
  previewOnly: boolean;
};

export function resolveLockedArticleSurface(
  canPublish: boolean,
  reviewStatus: CmsReviewStatus,
  currentRevisionPublished = false
): ArticleEditorSurface {
  return {
    mode: canPublish && reviewStatus === "approved" ? "publish" : "review",
    panelOpen: !currentRevisionPublished,
    previewOnly: true
  };
}

export function resolveArticleOpeningSurface(
  canEdit: boolean,
  canPublish: boolean,
  reviewStatus: CmsReviewStatus,
  currentRevisionPublished = false
): ArticleEditorSurface | null {
  if (canEdit && reviewStatus === "changes_requested") {
    return { mode: "review", panelOpen: true, previewOnly: false };
  }
  if (!canEdit || ["in_review", "approved"].includes(reviewStatus)) {
    return resolveLockedArticleSurface(canPublish, reviewStatus, currentRevisionPublished);
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
