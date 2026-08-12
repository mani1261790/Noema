import type {
  CmsPublicationStatus,
  CmsReviewStatus
} from "@noema/cms";

const stages = ["下書き", "レビュー中", "承認済み", "公開"] as const;

function currentStage(
  reviewStatus: CmsReviewStatus | null,
  publicationStatus: CmsPublicationStatus
): number {
  if (publicationStatus === "archived") return 3;
  if (publicationStatus === "published" && reviewStatus === "approved") return 3;
  if (reviewStatus === "in_review") return 1;
  if (reviewStatus === "approved") return 2;
  return 0;
}

export function getCmsJourneyStatus(
  reviewStatus: CmsReviewStatus | null,
  publicationStatus: CmsPublicationStatus
): { detail: string | null; label: string; step: number } {
  const step = currentStage(reviewStatus, publicationStatus);
  if (!reviewStatus) return { detail: "最初の保存でCMSに登録", label: "新しい下書き", step };
  if (publicationStatus === "archived") return { detail: "読者向け公開は終了", label: "公開終了", step };
  if (publicationStatus === "published" && reviewStatus !== "approved") {
    const label = reviewStatus === "in_review"
      ? "新しい版をレビュー中"
      : reviewStatus === "changes_requested"
        ? "公開中・新しい版は要修正"
        : "公開中・新しい版は下書き";
    return { detail: "現在の公開版はそのまま", label, step };
  }
  if (publicationStatus === "published") return { detail: null, label: "公開中", step };
  if (reviewStatus === "changes_requested") return { detail: "レビューコメントを確認して修正", label: "要修正", step };
  return { detail: null, label: stages[step], step };
}

export function CmsPublicationJourney({
  compact = false,
  publicationStatus,
  reviewStatus
}: {
  compact?: boolean;
  publicationStatus: CmsPublicationStatus;
  reviewStatus: CmsReviewStatus | null;
}) {
  const status = getCmsJourneyStatus(reviewStatus, publicationStatus);
  return (
    <div className={`studio-journey ${compact ? "is-compact" : ""}`}>
      <p className="studio-journey__current">
        <strong>{status.label}</strong>
        <span>{status.step + 1} / {stages.length}</span>
        {status.detail ? <small>{status.detail}</small> : null}
      </p>
      <ol aria-label={`公開までの進行状況。現在は${status.label}`}>
        {stages.map((stage, index) => (
          <li
            aria-current={index === status.step ? "step" : undefined}
            className={index < status.step ? "is-complete" : index === status.step ? "is-current" : ""}
            key={stage}
          >
            <span aria-hidden="true">{index + 1}</span>
            <strong>{stage}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}
