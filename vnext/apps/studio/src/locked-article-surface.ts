import type { CmsReviewStatus } from "@noema/cms";

export function resolveLockedArticleSurface(
  canPublish: boolean,
  reviewStatus: CmsReviewStatus
): { mode: "publish" | "review"; previewOnly: true } {
  return {
    mode: canPublish && reviewStatus === "approved" ? "publish" : "review",
    previewOnly: true
  };
}
