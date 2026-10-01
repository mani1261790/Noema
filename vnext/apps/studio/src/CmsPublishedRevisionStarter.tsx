import type { CmsArticleDetail } from "@noema/cms";

export function canStartPublishedRevision(
  article: CmsArticleDetail | null,
  canEdit: boolean
): boolean {
  return Boolean(
    canEdit &&
    article?.publicationStatus === "published" &&
    article.reviewStatus === "approved" &&
    article.publishedRevisionNumber === article.revisionNumber
  );
}

export function CmsPublishedRevisionStarter({
  article,
  busy,
  canEdit,
  onStart
}: {
  article: CmsArticleDetail | null;
  busy: boolean;
  canEdit: boolean;
  onStart: () => void;
}) {
  if (!article || !canStartPublishedRevision(article, canEdit)) return null;
  const nextRevisionNumber = article.revisionNumber + 1;

  return (
    <section
      aria-labelledby="cms-start-published-revision-heading"
      className="studio-publish-readiness is-ready"
    >
      <strong id="cms-start-published-revision-heading">
        revision {article.revisionNumber} は現在公開中です。
      </strong>
      <p>
        読者向けの内容を変えずに、同じ内容から編集用のrevision {nextRevisionNumber}を作成します。
      </p>
      <button
        className="dads-button"
        data-size="md"
        data-type="solid-fill"
        disabled={busy}
        onClick={onStart}
        type="button"
      >
        {busy ? "新しいrevisionを作成中…" : `新しいrevision ${nextRevisionNumber}を作る`}
      </button>
    </section>
  );
}
